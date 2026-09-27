// Vercel Function entry point. vercel.json rewrites every non-static path here.
import { handle } from "../lib/app.js";

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
