export const GITHUB_REPO_URL = "https://github.com/JunAkerBuilds/CorosLink";
export const GITHUB_REPO_API = "https://api.github.com/repos/JunAkerBuilds/CorosLink";

export function formatStarCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (count >= 10_000) {
    return `${Math.round(count / 1000)}k`;
  }
  if (count >= 1_000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return count.toLocaleString();
}
