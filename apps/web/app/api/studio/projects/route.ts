import { z } from "zod";
import { StudioProjectError, StudioProjectStore, SaveProject } from "../../../../../../packages/automation/src/studio-projects";
import { getStore } from "../../../lib/data";

export const dynamic = "force-dynamic";

const Mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), value: SaveProject }).strict(),
  z.object({ action: z.literal("create-autopilot"), projectId: z.string().uuid(), revision: z.number().int().positive() }).strict(),
]);

function failure(error: unknown) {
  if (error instanceof StudioProjectError)
    return Response.json({ error: error.message, code: error.code }, { status: error.code === "conflict" ? 409 : 404 });
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return Response.json({ error: "Check the project fields / Kiểm tra lại thông tin dự án", code: "invalid_input" }, { status: 400 });
  return Response.json({ error: "Cannot access project profiles / Không thể truy cập hồ sơ dự án", code: "storage_error" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const projects = new StudioProjectStore(await getStore()), id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ projects: await projects.list() });
    z.string().uuid().parse(id);
    const history = await projects.history(id);
    if (!history.length) throw new StudioProjectError("not_found", "Project not found / Không tìm thấy dự án");
    return Response.json({ project: history.at(-1), history });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      request.headers.get("origin") !== url.origin || request.headers.get("host") !== url.host)
    return Response.json({ error: "Invalid origin / Nguồn yêu cầu không hợp lệ", code: "invalid_origin" }, { status: 403 });
  try {
    const body = Mutation.parse(await request.json()), projects = new StudioProjectStore(await getStore());
    return Response.json(body.action === "save" ? await projects.save(body.value) : await projects.createAutopilot(body.projectId, body.revision));
  } catch (error) { return failure(error); }
}
