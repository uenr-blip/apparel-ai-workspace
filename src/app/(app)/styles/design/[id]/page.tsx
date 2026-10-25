import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { ACTION_TYPES } from "@/lib/constants";
import { canApproveAction } from "@/server/permissions";
import { DesignStudioError, getDesignProject } from "@/server/services/design-studio";
import { listStyleSummaries } from "@/server/services/style-thread";
import { DesignStudio } from "../../design-studio";

export default async function DesignStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const loaded = await loadDesignStudio(session.organizationId, id);
  if (!loaded) notFound();
  return (
    <DesignStudio
      project={loaded.project}
      catalog={loaded.catalog}
      canEdit={canApproveAction(session.role, ACTION_TYPES.generateDesignImage)}
    />
  );
}

async function loadDesignStudio(organizationId: string, id: string) {
  try {
    const [project, styles] = await Promise.all([
      getDesignProject(organizationId, id),
      listStyleSummaries(organizationId),
    ]);
    const catalog = [...styles]
      .filter((item) => item.imageSrc)
      .sort((left, right) => styleRank(left) - styleRank(right))
      .slice(0, 8)
      .map((item) => ({ id: item.id, code: item.code, name: item.name, imageSrc: item.imageSrc }));
    return { project, catalog };
  } catch (error) {
    if (error instanceof DesignStudioError) return null;
    throw error;
  }
}

function styleRank(item: { code: string; imageSrc: string }) {
  if (item.code === "ST-26018") return 0;
  if (item.imageSrc.startsWith("/styles/")) return 1;
  return 2;
}
