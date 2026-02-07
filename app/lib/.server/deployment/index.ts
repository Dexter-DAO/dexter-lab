/**
 * Deployment Module
 *
 * Exports the deployment service and types for x402 resource management.
 */

export { DeploymentService, reconcileState, default } from './deployment-service';
export * from './types';
export {
  deployResource,
  buildImage,
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
  getContainerStatus,
  getContainerLogs,
  listResourceContainers,
} from './docker-client';
