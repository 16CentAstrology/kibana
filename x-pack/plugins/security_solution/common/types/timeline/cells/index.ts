/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EuiDataGridCellValueElementProps } from '@elastic/eui';
import type { Filter } from '@kbn/es-query';
import type { ColumnHeaderOptions, RowRenderer } from '../..';
import type { Ecs } from '../../../ecs';
import type { BrowserFields, TimelineNonEcsData } from '../../../search_strategy';

/** The following props are provided to the function called by `renderCellValue` */
export type CellValueElementProps = EuiDataGridCellValueElementProps & {
  asPlainText?: boolean;
  browserFields?: BrowserFields;
  data: TimelineNonEcsData[];
  ecsData?: Ecs;
  eventId: string; // _id
  globalFilters?: Filter[];
  header: ColumnHeaderOptions;
  isDraggable: boolean;
  isTimeline?: boolean; // Default cell renderer is used for both the alert table and timeline. This allows us to cheaply separate concerns
  linkValues: string[] | undefined;
  rowRenderers?: RowRenderer[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setFlyoutAlert?: (data: any) => void;
  scopeId: string;
  truncate?: boolean;
  key?: string;
  closeCellPopover?: () => void;
  enableActions?: boolean;
};
