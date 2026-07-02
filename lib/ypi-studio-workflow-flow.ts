import type {
  YpiStudioWorkflow,
  YpiStudioWorkflowFlow,
  YpiStudioWorkflowFlowTransition,
  YpiStudioWorkflowState,
  YpiStudioWorkflowTransition,
} from "./ypi-studio-types";

function targetTerminalStatus(workflow: YpiStudioWorkflow): string | undefined {
  if (workflow.states.completed) return "completed";
  return workflow.terminalStatuses.find((status) => workflow.states[status]);
}

function isMainPathTransition(workflow: YpiStudioWorkflow, transition: YpiStudioWorkflowTransition, targetTerminal?: string): boolean {
  return !transition.overrideAllowed
    && transition.to !== transition.from
    && (!workflow.terminalStatuses.includes(transition.to) || transition.to === targetTerminal);
}

export function orderYpiStudioWorkflowStates(workflow: YpiStudioWorkflow | null | undefined, currentStatus?: string | null): YpiStudioWorkflowState[] {
  if (!workflow) return [];
  const targetTerminal = targetTerminalStatus(workflow);
  const output: YpiStudioWorkflowState[] = [];
  const seen = new Set<string>();
  let current = workflow.initialStatus;

  if (!current || !workflow.states[current]) {
    const states = Object.values(workflow.states).sort((a, b) => a.progress - b.progress || a.id.localeCompare(b.id));
    if (currentStatus && workflow.states[currentStatus] && !states.some((state) => state.id === currentStatus)) states.push(workflow.states[currentStatus]);
    return states;
  }

  while (current && workflow.states[current] && !seen.has(current)) {
    output.push(workflow.states[current]);
    seen.add(current);
    if (current === targetTerminal) break;
    const next = workflow.transitions.find((transition) => transition.from === current && isMainPathTransition(workflow, transition, targetTerminal));
    if (!next) break;
    current = next.to;
  }

  if (currentStatus && !seen.has(currentStatus) && workflow.states[currentStatus]) {
    const isPostCompletion = currentStatus === "archived" && targetTerminal === "completed";
    if (!isPostCompletion) {
      const insertAfterIndex = output.reduce((bestIndex, state, index) => (
        workflow.transitions.some((transition) => transition.from === state.id && transition.to === currentStatus) ? index : bestIndex
      ), -1);
      if (insertAfterIndex >= 0) output.splice(insertAfterIndex + 1, output.length, workflow.states[currentStatus]);
      else {
        if (targetTerminal) {
          const terminalIndex = output.findIndex((state) => state.id === targetTerminal);
          if (terminalIndex >= 0) output.splice(terminalIndex, 1);
        }
        output.push(workflow.states[currentStatus]);
      }
    } else {
      output.push(workflow.states[currentStatus]);
    }
  }

  return output;
}

function transitionKey(transition: Pick<YpiStudioWorkflowTransition, "from" | "to">): string {
  return `${transition.from}\u0000${transition.to}`;
}

function projectTransition(workflow: YpiStudioWorkflow, transition: YpiStudioWorkflowTransition): YpiStudioWorkflowFlowTransition {
  return {
    transition,
    fromState: workflow.states[transition.from],
    toState: workflow.states[transition.to],
  };
}

export function getYpiStudioWorkflowBranchTransitions(workflow: YpiStudioWorkflow, orderedStates: YpiStudioWorkflowState[]): YpiStudioWorkflowFlowTransition[] {
  const mainKeys = new Set<string>();
  for (let index = 0; index < orderedStates.length - 1; index += 1) {
    mainKeys.add(transitionKey({ from: orderedStates[index].id, to: orderedStates[index + 1].id }));
  }
  return workflow.transitions
    .filter((transition) => !mainKeys.has(transitionKey(transition)))
    .map((transition) => projectTransition(workflow, transition));
}

export function buildYpiStudioWorkflowFlow(workflow: YpiStudioWorkflow, currentStatus?: string | null): YpiStudioWorkflowFlow {
  const orderedStates = orderYpiStudioWorkflowStates(workflow, currentStatus);
  const mainTransitions: YpiStudioWorkflowFlowTransition[] = [];
  const warnings: string[] = [];
  for (let index = 0; index < orderedStates.length - 1; index += 1) {
    const from = orderedStates[index].id;
    const to = orderedStates[index + 1].id;
    const transition = workflow.transitions.find((item) => item.from === from && item.to === to);
    if (transition) mainTransitions.push(projectTransition(workflow, transition));
    else warnings.push(`No transition found for displayed path ${from} → ${to}.`);
  }
  if (!workflow.states[workflow.initialStatus]) warnings.push(`Initial status ${workflow.initialStatus} is missing.`);
  if (currentStatus && !workflow.states[currentStatus]) warnings.push(`Current status ${currentStatus} is not defined in this workflow.`);
  return {
    steps: orderedStates.map((state, index) => ({ state, index, isCurrent: state.id === currentStatus })),
    mainTransitions,
    branchTransitions: getYpiStudioWorkflowBranchTransitions(workflow, orderedStates),
    warnings,
  };
}
