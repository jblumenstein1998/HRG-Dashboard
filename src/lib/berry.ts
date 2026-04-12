export const BERRY_BASE_URL = "https://board-api.berry-ai.com";
export const BERRY_DASHBOARD_ID = 66;

export type Branch = {
  id: number;
  name: string;
  location?: string;
  [key: string]: unknown;
};

export type ChartDataPoint = {
  label?: string;
  value?: number | string;
  [key: string]: unknown;
};

export async function berryFetch(
  path: string,
  token: string,
  options?: RequestInit
): Promise<Response> {
  return fetch(`${BERRY_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
}
