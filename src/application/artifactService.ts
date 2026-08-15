import type { AgentArtifactProposal } from '../domain/agentRun';
import {
  Artifact,
  createArtifact,
  createArtifactRevision,
} from '../domain/artifact';
import { ArtifactNotFoundError, ProjectNotFoundError } from '../domain/errors';
import { assertLabOwnedBy } from './labAccess';
import type { ArtifactRepository } from './artifactRepository';
import type { LabRepository } from './labRepository';
import type { ProjectRepository } from './projectRepository';

/** Revision input from the PI: new content, optional title/type override. */
export interface CreateArtifactRevisionParams {
  content: string;
  title?: string;
  type?: string;
}

/**
 * Pre-authorized input for the Agent Runtime's artifact materialization. The
 * Runtime has already asserted the PI owns the Lab; the ArtifactService records
 * the run's lineage without re-authorizing.
 */
export interface MaterializeRunArtifactsParams {
  runId: string;
  projectId: string;
  taskId: string | null;
  agentId: string | null;
  /** Fallback content when a proposal carries none (acceptance #5). */
  summary: string;
  proposals: AgentArtifactProposal[];
}

/**
 * Persistent work products (SPEC-008, ADR-0004).
 *
 * PI-facing reads/revisions are authorized through the Project → Lab chain (an
 * Artifact has no `lab_id`). `materializeRunArtifacts` is the Runtime's success
 * path: it turns already-validated run proposals into durable Artifact rows so
 * research output lives outside the run transcript (acceptance #1, #5).
 */
export class ArtifactService {
  constructor(
    private readonly artifacts: ArtifactRepository,
    private readonly projects: ProjectRepository,
    private readonly labs: LabRepository,
  ) {}

  /**
   * Materializes a succeeded run's validated artifact proposals. Called by the
   * Agent Runtime after schema validation and a legal task-status application
   * (rule 8: the LLM output already passed the typed schema). Deterministic;
   * returns the created artifacts in proposal order so the caller can backfill
   * their ids into the persisted run result.
   */
  materializeRunArtifacts(params: MaterializeRunArtifactsParams): Artifact[] {
    return params.proposals.map((proposal) => {
      const artifact = createArtifact({
        projectId: params.projectId,
        taskId: params.taskId,
        creatorAgentId: params.agentId,
        type: proposal.type,
        title: proposal.title,
        content: proposal.content?.trim() ? proposal.content : params.summary,
        metadata: { sourceRunId: params.runId, sourceType: 'agent-run' },
      });
      this.artifacts.insert(artifact);
      return artifact;
    });
  }

  getArtifact(requesterUserId: string, artifactId: string): Artifact {
    const artifact = this.artifacts.findById(artifactId);
    if (!artifact) {
      throw new ArtifactNotFoundError(artifactId);
    }
    this.assertProjectOwnedBy(requesterUserId, artifact.projectId);
    return artifact;
  }

  /** All versions of a Project's artifacts, newest first (acceptance #3). */
  listProjectArtifacts(requesterUserId: string, projectId: string): Artifact[] {
    this.assertProjectOwnedBy(requesterUserId, projectId);
    return this.artifacts.findByProject(projectId);
  }

  /** Creates the next version of an artifact (version metadata, acceptance #4). */
  createRevision(
    requesterUserId: string,
    artifactId: string,
    params: CreateArtifactRevisionParams,
  ): Artifact {
    const parent = this.getArtifact(requesterUserId, artifactId);
    const revision = createArtifactRevision(parent, params);
    this.artifacts.insert(revision);
    return revision;
  }

  private assertProjectOwnedBy(userId: string, projectId: string): void {
    const project = this.projects.findById(projectId);
    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }
    assertLabOwnedBy(this.labs, userId, project.labId);
  }
}
