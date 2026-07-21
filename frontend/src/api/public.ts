import { getData } from "./client";

export async function fetchPublicSettings() {
  return getData<Record<string, string>>("/public/settings");
}
