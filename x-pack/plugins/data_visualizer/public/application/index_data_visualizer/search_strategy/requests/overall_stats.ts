/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type * as estypes from '@elastic/elasticsearch/lib/api/typesWithBodyKey';
import { get } from 'lodash';
import { Query } from '@kbn/es-query';
import { IKibanaSearchResponse } from '@kbn/data-plugin/common';
import type { AggCardinality } from '@kbn/ml-agg-utils';
import { isPopulatedObject } from '@kbn/ml-is-populated-object';
import { buildAggregationWithSamplingOption } from './build_random_sampler_agg';
import {
  buildBaseFilterCriteria,
  getSafeAggregationName,
} from '../../../../../common/utils/query_utils';
import { getDatafeedAggregations } from '../../../../../common/utils/datafeed_utils';
import { AggregatableField, NonAggregatableField } from '../../types/overall_stats';
import { Aggs, SamplingOption } from '../../../../../common/types/field_stats';

export const checkAggregatableFieldsExistRequest = (
  dataViewTitle: string,
  query: Query['query'],
  aggregatableFields: string[],
  samplingOption: SamplingOption,
  timeFieldName: string | undefined,
  earliestMs?: number,
  latestMs?: number,
  datafeedConfig?: estypes.MlDatafeed,
  runtimeMappings?: estypes.MappingRuntimeFields
): estypes.SearchRequest => {
  const index = dataViewTitle;
  const size = 0;
  const filterCriteria = buildBaseFilterCriteria(timeFieldName, earliestMs, latestMs, query);
  const datafeedAggregations = getDatafeedAggregations(datafeedConfig);

  // Value count aggregation faster way of checking if field exists than using
  // filter aggregation with exists query.
  const aggs: Aggs = datafeedAggregations !== undefined ? { ...datafeedAggregations } : {};

  // Combine runtime fields from the data view as well as the datafeed
  const combinedRuntimeMappings: estypes.MappingRuntimeFields = {
    ...(isPopulatedObject(runtimeMappings) ? runtimeMappings : {}),
    ...(isPopulatedObject(datafeedConfig) && isPopulatedObject(datafeedConfig.runtime_mappings)
      ? datafeedConfig.runtime_mappings
      : {}),
  };

  aggregatableFields.forEach((field, i) => {
    const safeFieldName = getSafeAggregationName(field, i);
    aggs[`${safeFieldName}_count`] = {
      filter: { exists: { field } },
    };

    let cardinalityField: AggCardinality;
    if (datafeedConfig?.script_fields?.hasOwnProperty(field)) {
      cardinalityField = aggs[`${safeFieldName}_cardinality`] = {
        cardinality: { script: datafeedConfig?.script_fields[field].script },
      };
    } else {
      cardinalityField = {
        cardinality: { field },
      };
    }
    aggs[`${safeFieldName}_cardinality`] = cardinalityField;
  });

  const searchBody = {
    query: {
      bool: {
        filter: filterCriteria,
      },
    },
    ...(isPopulatedObject(aggs)
      ? { aggs: buildAggregationWithSamplingOption(aggs, samplingOption) }
      : {}),
    ...(isPopulatedObject(combinedRuntimeMappings)
      ? { runtime_mappings: combinedRuntimeMappings }
      : {}),
  };

  return {
    index,
    // @ts-expect-error `track_total_hits` not allowed at top level for `typesWithBodyKey`
    track_total_hits: false,
    size,
    body: searchBody,
  };
};

export interface AggregatableFieldOverallStats extends IKibanaSearchResponse {
  aggregatableFields: string[];
}

export type NonAggregatableFieldOverallStats = IKibanaSearchResponse;

export function isAggregatableFieldOverallStats(
  arg: unknown
): arg is AggregatableFieldOverallStats {
  return isPopulatedObject(arg, ['aggregatableFields']);
}

export function isNonAggregatableFieldOverallStats(
  arg: unknown
): arg is NonAggregatableFieldOverallStats {
  return isPopulatedObject(arg, ['rawResponse']);
}

export const processAggregatableFieldsExistResponse = (
  responses: AggregatableFieldOverallStats[] | undefined,
  aggregatableFields: string[],
  datafeedConfig?: estypes.MlDatafeed
) => {
  const stats = {
    aggregatableExistsFields: [] as AggregatableField[],
    aggregatableNotExistsFields: [] as AggregatableField[],
  };

  if (!responses || aggregatableFields.length === 0) return stats;

  responses.forEach(({ rawResponse: body, aggregatableFields: aggregatableFieldsChunk }) => {
    const aggregations = body.aggregations;

    const aggsPath = ['sample'];
    const sampleCount = aggregations.sample.doc_count;
    aggregatableFieldsChunk.forEach((field, i) => {
      const safeFieldName = getSafeAggregationName(field, i);
      // Sampler agg will yield doc_count that's bigger than the actual # of sampled records
      // because it uses the stored _doc_count if available
      // https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping-doc-count-field.html
      // therefore we need to correct it by multiplying by the sampled probability
      const count = get(aggregations, [...aggsPath, `${safeFieldName}_count`, 'doc_count'], 0);
      const multiplier =
        count > sampleCount ? get(aggregations, [...aggsPath, 'probability'], 1) : 1;
      if (count > 0) {
        const cardinality = get(
          aggregations,
          [...aggsPath, `${safeFieldName}_cardinality`, 'value'],
          0
        );
        stats.aggregatableExistsFields.push({
          fieldName: field,
          existsInDocs: true,
          stats: {
            sampleCount,
            count: count * multiplier,
            cardinality,
          },
        });
      } else {
        if (
          datafeedConfig?.script_fields?.hasOwnProperty(field) ||
          datafeedConfig?.runtime_mappings?.hasOwnProperty(field)
        ) {
          const cardinality = get(
            aggregations,
            [...aggsPath, `${safeFieldName}_cardinality`, 'value'],
            0
          );
          stats.aggregatableExistsFields.push({
            fieldName: field,
            existsInDocs: true,
            stats: {
              sampleCount,
              count,
              cardinality,
            },
          });
        } else {
          stats.aggregatableNotExistsFields.push({
            fieldName: field,
            existsInDocs: false,
            stats: {},
          });
        }
      }
    });
  });

  return stats as {
    aggregatableExistsFields: AggregatableField[];
    aggregatableNotExistsFields: AggregatableField[];
  };
};

export const checkNonAggregatableFieldExistsRequest = (
  dataViewTitle: string,
  query: Query['query'],
  field: string,
  timeFieldName: string | undefined,
  earliestMs: number | undefined,
  latestMs: number | undefined,
  runtimeMappings?: estypes.MappingRuntimeFields
): estypes.SearchRequest => {
  const index = dataViewTitle;
  const size = 0;
  const filterCriteria = buildBaseFilterCriteria(timeFieldName, earliestMs, latestMs, query);

  const searchBody = {
    query: {
      bool: {
        filter: filterCriteria,
      },
    },
    ...(isPopulatedObject(runtimeMappings) ? { runtime_mappings: runtimeMappings } : {}),
  };
  if (Array.isArray(filterCriteria)) {
    filterCriteria.push({ exists: { field } });
  }

  return {
    index,
    // @ts-expect-error `size` not allowed at top level for `typesWithBodyKey`
    size,
    body: searchBody,
    // Small es optimization
    // Since we only need to know if at least 1 doc exists for the query
    track_total_hits: 1,
  };
};

export const processNonAggregatableFieldsExistResponse = (
  results: IKibanaSearchResponse[] | undefined,
  nonAggregatableFields: string[]
) => {
  const stats = {
    nonAggregatableExistsFields: [] as NonAggregatableField[],
    nonAggregatableNotExistsFields: [] as NonAggregatableField[],
  };

  if (!results || nonAggregatableFields.length === 0) return stats;

  nonAggregatableFields.forEach((fieldName) => {
    const foundField = results.find((r) => r.rawResponse.fieldName === fieldName);
    const existsInDocs = foundField !== undefined && foundField.rawResponse.hits.total > 0;
    const fieldData: NonAggregatableField = {
      fieldName,
      existsInDocs,
    };
    if (existsInDocs === true) {
      stats.nonAggregatableExistsFields.push(fieldData);
    } else {
      stats.nonAggregatableNotExistsFields.push(fieldData);
    }
  });
  return stats;
};
