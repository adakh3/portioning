import { NextRequest, NextResponse } from "next/server";

export function middleware(_request: NextRequest) {
  // Auth is handled client-side by AuthProvider.
  // Middleware only exists for the matcher config — pass everything through.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
