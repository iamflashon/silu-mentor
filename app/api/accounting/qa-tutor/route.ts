import { handleAccountingTutor } from "../tutor/route";

export async function POST(request: Request) {
  return handleAccountingTutor(request, true);
}
