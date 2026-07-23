import { NextResponse } from "next/server";
import { getTodayVsLastYear } from "@/lib/todayVsLastYear";

export async function GET() {
  const result = await getTodayVsLastYear();
  return NextResponse.json(result);
}
