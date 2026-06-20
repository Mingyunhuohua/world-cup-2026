import { simulateTournamentWithProgress } from "../model/simulate.ts";
import {
  buildSimulationWorkerProgress,
  isSimulationWorkerRequest,
  type SimulationWorkerError,
  type SimulationWorkerOutboundMessage,
  type SimulationWorkerResult
} from "./simulationProtocol.ts";

const workerContext = self as unknown as Worker;

workerContext.onmessage = (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isSimulationWorkerRequest(request)) {
    return;
  }

  const startedAt = Date.now();

  try {
    const simulation = simulateTournamentWithProgress(request.fixtures, request.teams, request.config, {
      iterations: request.iterations,
      seed: request.seed,
      progressStep: request.progressStep,
      onProgress: (progress) => {
        postWorkerMessage(
          buildSimulationWorkerProgress({
            requestId: request.requestId,
            completedIterations: progress.completedIterations,
            totalIterations: progress.totalIterations,
            elapsedMs: Date.now() - startedAt
          })
        );
      }
    });
    const result: SimulationWorkerResult = {
      type: "result",
      requestId: request.requestId,
      simulation,
      elapsedMs: Date.now() - startedAt
    };

    postWorkerMessage(result);
  } catch (error) {
    const response: SimulationWorkerError = {
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : "Simulation worker failed.",
      elapsedMs: Date.now() - startedAt
    };

    postWorkerMessage(response);
  }
};

function postWorkerMessage(message: SimulationWorkerOutboundMessage) {
  workerContext.postMessage(message);
}
