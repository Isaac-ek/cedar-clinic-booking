import { env } from "cloudflare:workers";
import { handleApi, type ApiEnv } from "../../../lib/booking-api";
export const dynamic = "force-dynamic";
const handler = (request: Request) => handleApi(request, env as ApiEnv);
export { handler as GET, handler as POST, handler as DELETE, handler as OPTIONS, handler as PUT, handler as PATCH };
