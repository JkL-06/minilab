import {
  applyProjectUpdate,
  createProject,
  type CreateProjectInput,
  type Project,
  type ProjectUpdatePatch,
} from '../domain/project';
import { ProjectNotFoundError } from '../domain/errors';
import { assertLabOwnedBy } from './labAccess';
import type { LabRepository } from './labRepository';
import type { ProjectRepository } from './projectRepository';

type CreateProjectParams = Omit<CreateProjectInput, 'labId'>;

/**
 * Application service for Projects.
 *
 * A Project belongs to exactly one Lab (DOMAIN_MODEL invariant #1). All
 * operations are gated on the requesting user owning the Project's Lab, which
 * rejects cross-lab reads/writes (SPEC-003 acceptance #3).
 */
export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly labs: LabRepository,
  ) {}

  createProject(requesterUserId: string, labId: string, params: CreateProjectParams): Project {
    this.assertLabOwnedBy(requesterUserId, labId);
    const project = createProject({ labId, ...params });
    this.projects.insert(project);
    return project;
  }

  listProjects(requesterUserId: string, labId: string): Project[] {
    this.assertLabOwnedBy(requesterUserId, labId);
    return this.projects.findByLab(labId);
  }

  getProject(requesterUserId: string, projectId: string): Project {
    const project = this.requireProject(projectId);
    this.assertLabOwnedBy(requesterUserId, project.labId);
    return project;
  }

  updateProject(requesterUserId: string, projectId: string, patch: ProjectUpdatePatch): Project {
    const project = this.requireProject(projectId);
    this.assertLabOwnedBy(requesterUserId, project.labId);
    const updated = applyProjectUpdate(project, patch);
    this.projects.update(updated);
    return updated;
  }

  private requireProject(projectId: string): Project {
    const project = this.projects.findById(projectId);
    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }
    return project;
  }

  private assertLabOwnedBy(userId: string, labId: string): void {
    assertLabOwnedBy(this.labs, userId, labId);
  }
}
