import { selectCursorFinalText } from "./cursor-run-final-text.js";
import { formatCursorSdkAbortMessage, formatCursorSdkRunFailureDetail, resolveCursorSdkAbortCause, sanitizeCursorProviderError, } from "./cursor-provider-errors.js";
import { hasUsableText } from "./cursor-record-utils.js";
import { buildIncompleteCursorToolRunOutcome, } from "./cursor-incomplete-tool-visibility.js";
function hasCursorAssistantText(resultText, textDeltas, fallbackText) {
    return (hasUsableText(typeof resultText === "string" ? resultText : undefined) ||
        hasUsableText(textDeltas.join("")) ||
        hasUsableText(fallbackText));
}
export function isCursorRunFinishedSuccessfully(outcome) {
    return outcome.kind === "finished";
}
function buildCursorRunAbortMessage(signalAborted, sdkStatusCancelled) {
    return formatCursorSdkAbortMessage(resolveCursorSdkAbortCause({
        signalAborted,
        sdkStatusCancelled,
    }));
}
export function resolveCursorRunOutcome(params) {
    const { waitResult, signalAborted } = params;
    const sdkCancelled = waitResult.status === "cancelled";
    const callerAborted = signalAborted === true;
    if (callerAborted || sdkCancelled) {
        const incompleteTools = buildIncompleteCursorToolRunOutcome({
            status: "cancelled",
            signalAborted: callerAborted,
            assistantTextProduced: false,
        });
        return {
            kind: "cancelled",
            waitResult,
            incompleteTools,
            abortMessage: buildCursorRunAbortMessage(callerAborted, sdkCancelled),
        };
    }
    if (waitResult.status === "error") {
        const failureDetail = formatCursorSdkRunFailureDetail(waitResult, params.runResultFallback, params.runErrorFallback);
        return {
            kind: "error",
            waitResult,
            incompleteTools: buildIncompleteCursorToolRunOutcome({
                status: "error",
                assistantTextProduced: false,
            }),
            errorMessage: sanitizeCursorProviderError(failureDetail, params.resolvedApiKey ?? params.optionsApiKey, params.runtimeTarget),
        };
    }
    const assistantTextProduced = hasCursorAssistantText(waitResult.result, params.textDeltas, params.planTextCandidate);
    const incompleteTools = buildIncompleteCursorToolRunOutcome({
        status: waitResult.status,
        assistantTextProduced,
    });
    const finalText = selectCursorFinalText(waitResult.result, params.textDeltas, params.emittedText, params.planTextCandidate, params.selectFinalTextOptions);
    return {
        kind: "finished",
        waitResult,
        finalText,
        incompleteTools,
        assistantTextProduced,
    };
}
export function classifyCursorRunEmission(outcome) {
    switch (outcome.kind) {
        case "finished":
            return "finished";
        case "cancelled":
            return "cancelled";
        case "error":
            return "failed";
    }
}
export function getCursorRunAbortMessage(outcome) {
    if (outcome.kind === "cancelled")
        return outcome.abortMessage;
    return buildCursorRunAbortMessage(false, outcome.waitResult.status === "cancelled");
}
