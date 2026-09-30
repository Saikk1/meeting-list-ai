import {
  parseAssistantPlan,
  type AssistantMeetingInput,
  type AssistantPlan,
} from "./assistant-contract";

/**
 * Raised when a meeting-create plan cannot be edited unambiguously.
 */
export class AssistantPlanEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantPlanEditError";
  }
}

export type BuildAssistantCreateMeetingPlanOptions = {
  summary?: string;
  warnings?: readonly string[];
};

function normalizeMeetingInput(
  input: AssistantMeetingInput,
): AssistantMeetingInput {
  const normalized = { ...input };
  if (normalized.attendees) {
    normalized.attendees = normalized.attendees.filter((attendee) => attendee.name.trim());
    normalized.attendeeEstimate = Math.max(normalized.attendeeEstimate, normalized.attendees.length);
  }
  if (!normalized.parkingRequired) {
    normalized.vehicleCount = 0;
    if (normalized.vehicles) normalized.vehicles = [];
  }
  if (normalized.mealType !== "business") {
    normalized.alcoholRequired = false;
  }
  return normalized;
}

function hasDraftIdentity(input: AssistantMeetingInput) {
  return [input.title, input.date, input.startTime].every(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

/**
 * Builds the first executable plan from a locally edited meeting draft.
 * Empty identity fields mean that the draft is not ready yet, so callers can
 * keep rendering the editor without turning normal incompleteness into an
 * exception.
 */
export function buildAssistantCreateMeetingPlan(
  input: AssistantMeetingInput,
  options: BuildAssistantCreateMeetingPlanOptions = {},
): AssistantPlan | null {
  if (!hasDraftIdentity(input)) return null;

  return parseAssistantPlan({
    schemaVersion: 1,
    summary: options.summary ?? `创建会议：${input.title.trim()}`,
    clarification: null,
    warnings: [...(options.warnings ?? [])],
    actions: [
      {
        type: "meeting.create",
        input: normalizeMeetingInput(input),
      },
    ],
  });
}

/**
 * Applies form edits to the single `meeting.create` action in a plan.
 *
 * The helper is deliberately pure: neither the plan nor the supplied patch is
 * mutated. Cross-field invariants are normalized before the edited plan is
 * passed through the strict assistant-plan parser again.
 */
export function applyMeetingCreatePatch(
  plan: AssistantPlan,
  patch: Partial<AssistantMeetingInput>,
): AssistantPlan {
  const createIndexes = plan.actions.flatMap((action, index) =>
    action.type === "meeting.create" ? [index] : [],
  );

  if (createIndexes.length === 0) {
    throw new AssistantPlanEditError(
      "无法编辑会议设置：操作计划中没有 meeting.create 操作",
    );
  }
  if (createIndexes.length > 1) {
    throw new AssistantPlanEditError(
      "无法编辑会议设置：操作计划中存在多个 meeting.create 操作",
    );
  }

  const actionIndex = createIndexes[0];
  const action = plan.actions[actionIndex];
  if (action.type !== "meeting.create") {
    // The index was obtained from the predicate above; this branch only keeps
    // TypeScript's narrowing local and makes the invariant explicit.
    throw new AssistantPlanEditError("无法定位待创建的会议设置");
  }

  const input = normalizeMeetingInput({
    ...action.input,
    ...patch,
  });

  const actions = plan.actions.map((current, index) =>
    index === actionIndex
      ? {
          type: "meeting.create" as const,
          input,
        }
      : current,
  );

  return parseAssistantPlan({
    ...plan,
    actions,
  });
}
