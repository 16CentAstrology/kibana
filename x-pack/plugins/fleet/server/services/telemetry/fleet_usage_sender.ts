/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import type {
  ConcreteTaskInstance,
  TaskManagerStartContract,
  TaskManagerSetupContract,
} from '@kbn/task-manager-plugin/server';
import { throwUnrecoverableError } from '@kbn/task-manager-plugin/server';
import type { CoreSetup } from '@kbn/core/server';
import { withSpan } from '@kbn/apm-utils';

import type { Usage } from '../../collectors/register';

import { appContextService } from '../app_context';

import { fleetUsagesSchema } from './fleet_usages_schema';

const EVENT_TYPE = 'fleet_usage';

export class FleetUsageSender {
  private taskManager?: TaskManagerStartContract;
  private taskVersion = '1.0.0';
  private taskType = 'Fleet-Usage-Sender';
  private wasStarted: boolean = false;
  private interval = '1h';
  private timeout = '1m';
  private abortController = new AbortController();

  constructor(
    taskManager: TaskManagerSetupContract,
    core: CoreSetup,
    fetchUsage: (abortController: AbortController) => Promise<Usage | undefined>
  ) {
    taskManager.registerTaskDefinitions({
      [this.taskType]: {
        title: 'Fleet Usage Sender',
        timeout: this.timeout,
        maxAttempts: 1,
        createTaskRunner: ({ taskInstance }: { taskInstance: ConcreteTaskInstance }) => {
          return {
            run: async () => {
              return withSpan({ name: this.taskType, type: 'telemetry' }, () =>
                this.runTask(taskInstance, core, () => fetchUsage(this.abortController))
              );
            },

            cancel: async () => {
              this.abortController.abort('task timed out');
            },
          };
        },
      },
    });
    this.registerTelemetryEventType(core);
  }

  private runTask = async (
    taskInstance: ConcreteTaskInstance,
    core: CoreSetup,
    fetchUsage: () => Promise<Usage | undefined>
  ) => {
    if (!this.wasStarted) {
      appContextService.getLogger().debug('[runTask()] Aborted. Task not started yet');
      return;
    }
    // Check that this task is current
    if (taskInstance.id !== this.taskId) {
      throwUnrecoverableError(new Error('Outdated task version for task: ' + taskInstance.id));
      return;
    }
    appContextService.getLogger().info('Running Fleet Usage telemetry send task');

    try {
      const usageData = await fetchUsage();
      if (!usageData) {
        return;
      }
      appContextService.getLogger().debug(JSON.stringify(usageData));
      core.analytics.reportEvent(EVENT_TYPE, usageData);
    } catch (error) {
      appContextService
        .getLogger()
        .error('Error occurred while sending Fleet Usage telemetry: ' + error);
    }
  };

  private get taskId() {
    return `${this.taskType}-${this.taskVersion}`;
  }

  public async start(taskManager: TaskManagerStartContract) {
    this.taskManager = taskManager;

    if (!taskManager) {
      appContextService.getLogger().error('missing required service during start');
      return;
    }

    this.wasStarted = true;

    try {
      appContextService.getLogger().info(`Task ${this.taskId} scheduled with interval 1h`);

      await this.taskManager.ensureScheduled({
        id: this.taskId,
        taskType: this.taskType,
        schedule: {
          interval: this.interval,
        },
        scope: ['fleet'],
        state: {},
        params: {},
      });
    } catch (e) {
      appContextService.getLogger().error(`Error scheduling task, received error: ${e}`);
    }
  }

  /**
   *  took schema from [here](https://github.com/elastic/kibana/blob/main/x-pack/plugins/fleet/server/collectors/register.ts#L53) and adapted to EBT format
   */
  private registerTelemetryEventType(core: CoreSetup): void {
    core.analytics.registerEventType({
      eventType: EVENT_TYPE,
      schema: fleetUsagesSchema,
    });
  }
}
