// Central registration of all graphile-worker tasks. The TASK_NAMES constants
// from @solar/contracts are the single source of truth — the task list keys
// MUST match what the web app enqueues with.

import { TASK_NAMES } from "@solar/contracts";

import { eventPublishFollowupsTask } from "./tasks/event.publish_followups.js";
import { incentiveCalculateTask } from "./tasks/incentive.calculate.js";
import { incentiveCancelOrNegativeAdjustTask } from "./tasks/incentive.cancel_or_negative_adjust.js";
import { monthlyAggregateTask } from "./tasks/monthly.aggregate.js";
import { makeSendEmailTask } from "./tasks/notification.send_email.js";
import { sendInappTask } from "./tasks/notification.send_inapp.js";
import { sendLineTask } from "./tasks/notification.send_line.js";
import { reminderDispatchTask } from "./tasks/reminder.dispatch.js";

import type { TaskList } from "graphile-worker";

export function buildTaskList(): TaskList {
  return {
    [TASK_NAMES.NOTIFICATION_SEND_EMAIL]: makeSendEmailTask(),
    [TASK_NAMES.NOTIFICATION_SEND_INAPP]: sendInappTask,
    [TASK_NAMES.NOTIFICATION_SEND_LINE]: sendLineTask,
    [TASK_NAMES.EVENT_PUBLISH_FOLLOWUPS]: eventPublishFollowupsTask,
    [TASK_NAMES.INCENTIVE_CALCULATE]: incentiveCalculateTask,
    [TASK_NAMES.INCENTIVE_CANCEL_OR_NEGATIVE_ADJUST]: incentiveCancelOrNegativeAdjustTask,
    [TASK_NAMES.MONTHLY_AGGREGATE]: monthlyAggregateTask,
    [TASK_NAMES.REMINDER_DISPATCH]: reminderDispatchTask,
  };
}
