const SUPPORTERS_ENDPOINT =
  "https://app.buymeacoffee.com/api/v1/timeline/project/10978680/?page=1&per_page=100";

export type PublicSupporter = {
  id: string;
  name: string;
  avatarUrl: string;
};

const FALLBACK_SUPPORTERS: PublicSupporter[] = [
  {
    id: "joe-c",
    name: "Joe C",
    avatarUrl:
      "https://cdn.buymeacoffee.com/uploads/profile_pictures/default/v2/FFB3A0/JC.png",
  },
  {
    id: "gunda-and-jan",
    name: "Gunda&Jan",
    avatarUrl:
      "https://cdn.buymeacoffee.com/uploads/profile_pictures/default/v2/80BEAF/GJ.png",
  },
  {
    id: "divilabotherbeonya",
    name: "DivilABotherBeOnYa",
    avatarUrl:
      "https://cdn.buymeacoffee.com/uploads/profile_pictures/default/v2/E3CBF4/DA.png",
  },
  {
    id: "anonymous-supporter",
    name: "Anonymous supporter",
    avatarUrl:
      "https://cdn.buymeacoffee.com/uploads/profile_pictures/default/v2/EC9689/SO.png",
  },
];

type TimelineResponse = {
  data?: Array<{
    supporter?: {
      id?: number | string;
      name?: string;
      dp?: string;
    };
  }>;
};

function isSafeAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "cdn.buymeacoffee.com";
  } catch {
    return false;
  }
}

export async function getPublicSupporters(): Promise<PublicSupporter[]> {
  try {
    const response = await fetch(SUPPORTERS_ENDPOINT, {
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      next: { revalidate: 3600 },
    });

    if (!response.ok) return FALLBACK_SUPPORTERS;

    const payload = (await response.json()) as TimelineResponse;
    const supporters = new Map<string, PublicSupporter>();

    for (const transaction of payload.data ?? []) {
      const supporter = transaction.supporter;
      const name = supporter?.name?.trim();
      const avatarUrl = supporter?.dp?.trim();

      if (!name || !avatarUrl || !isSafeAvatarUrl(avatarUrl)) continue;

      const id = String(supporter?.id ?? `${name}-${avatarUrl}`);
      supporters.set(id, {
        id,
        name: name === "Someone" ? "Anonymous supporter" : name,
        avatarUrl,
      });
    }

    return supporters.size > 0
      ? Array.from(supporters.values())
      : FALLBACK_SUPPORTERS;
  } catch {
    return FALLBACK_SUPPORTERS;
  }
}
