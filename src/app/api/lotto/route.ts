import { NextResponse } from "next/server";

type Draw = {
  drwNo: number;
  drwNoDate: string;
  numbers: number[];
  bonus: number;
};

type Cache = {
  updatedAt: number;
  latest: number;
  draws: Map<number, Draw>;
  inFlight?: Promise<Cache>;
  blockedUntil?: number;
};

const API_BASE =
  "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=";
const CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const MAX_DRAW_GUESS = 10000;
const CONCURRENCY = 6;
const RETRIES = 2;
const BLOCK_TTL_MS = 1000 * 60 * 15;

class HtmlResponseError extends Error {
  constructor() {
    super("HTML response");
    this.name = "HtmlResponseError";
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __lottoCache: Cache | undefined;
}

function getCache(): Cache {
  if (!globalThis.__lottoCache) {
    globalThis.__lottoCache = {
      updatedAt: 0,
      latest: 0,
      draws: new Map(),
    };
  }
  return globalThis.__lottoCache;
}

async function fetchJson(url: string, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const raw = await response.text();
    const trimmed = raw.trim();
    if (trimmed.startsWith("<")) {
      throw new HtmlResponseError();
    }
    if (contentType.includes("application/json")) {
      return JSON.parse(raw) as Record<string, unknown>;
    }
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      throw new Error("Non-JSON response");
    }
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDrawOnce(no: number): Promise<Draw | null> {
  const data = await fetchJson(`${API_BASE}${no}`);
  if (data.returnValue !== "success") {
    return null;
  }
  const numbers = [
    Number(data.drwtNo1),
    Number(data.drwtNo2),
    Number(data.drwtNo3),
    Number(data.drwtNo4),
    Number(data.drwtNo5),
    Number(data.drwtNo6),
  ];
  const bonus = Number(data.bnusNo);
  if (numbers.some((n) => Number.isNaN(n)) || Number.isNaN(bonus)) {
    return null;
  }
  return {
    drwNo: Number(data.drwNo),
    drwNoDate: String(data.drwNoDate),
    numbers,
    bonus,
  };
}

async function fetchDraw(no: number): Promise<Draw | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      return await fetchDrawOnce(no);
    } catch (error) {
      if ((error as { name?: string }).name === "HtmlResponseError") {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  console.warn("Failed to fetch draw", no, lastError);
  return null;
}

async function findLatestDraw(): Promise<number> {
  const cache = getCache();
  let probe = cache.latest > 0 ? cache.latest : 1100;
  let draw = await fetchDraw(probe);

  if (!draw) {
    let low = 1;
    let high = probe;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midDraw = await fetchDraw(mid);
      if (midDraw) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return Math.max(1, high);
  }

  let low = probe;
  let high = Math.min(probe * 2, MAX_DRAW_GUESS);
  while (high <= MAX_DRAW_GUESS) {
    const highDraw = await fetchDraw(high);
    if (highDraw) {
      low = high;
      high = Math.min(high * 2, MAX_DRAW_GUESS);
      if (low === MAX_DRAW_GUESS) {
        return low;
      }
    } else {
      break;
    }
  }

  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    const midDraw = await fetchDraw(mid);
    if (midDraw) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

async function fetchRange(
  start: number,
  end: number,
  cache: Cache,
  missing: number[],
) {
  let current = start;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const no = current;
      if (no > end) {
        return;
      }
      current += 1;
      const draw = await fetchDraw(no);
      if (draw) {
        cache.draws.set(no, draw);
      } else {
        missing.push(no);
      }
    }
  });
  await Promise.all(workers);
}

async function updateCache(): Promise<Cache> {
  const cache = getCache();
  if (cache.inFlight) {
    return cache.inFlight;
  }

  cache.inFlight = (async () => {
    if (cache.blockedUntil && Date.now() < cache.blockedUntil) {
      cache.updatedAt = Date.now();
      return cache;
    }

    let latest: number;
    try {
      latest = await findLatestDraw();
    } catch (error) {
      if ((error as { name?: string }).name === "HtmlResponseError") {
        cache.blockedUntil = Date.now() + BLOCK_TTL_MS;
        cache.updatedAt = Date.now();
        return cache;
      }
      throw error;
    }
    const missing: number[] = [];
    const start = cache.latest > 0 ? cache.latest + 1 : 1;
    if (start <= latest) {
      await fetchRange(start, latest, cache, missing);
    }

    cache.latest = latest;
    cache.updatedAt = Date.now();
    (cache as Cache & { missing?: number[] }).missing = missing;
    return cache;
  })();

  try {
    return await cache.inFlight;
  } finally {
    cache.inFlight = undefined;
  }
}

function buildRanking(draws: Iterable<Draw>, includeBonus: boolean) {
  const counts = Array.from({ length: 45 }, (_, index) => ({
    num: index + 1,
    count: 0,
  }));
  for (const draw of draws) {
    for (const num of draw.numbers) {
      counts[num - 1].count += 1;
    }
    if (includeBonus) {
      counts[draw.bonus - 1].count += 1;
    }
  }

  const ranking = [...counts].sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return a.num - b.num;
  });

  const maxCount = ranking[0]?.count ?? 0;

  return {
    counts,
    ranking,
    top6: ranking.slice(0, 6).map((item) => item.num),
    next6: ranking.slice(6, 12).map((item) => item.num),
    top18: ranking.slice(0, 18).map((item) => item.num),
    hasData: maxCount > 0,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const includeBonus = url.searchParams.get("includeBonus") === "1";

  const cache = getCache();
  const isFresh = Date.now() - cache.updatedAt < CACHE_TTL_MS;
  const readyCache = isFresh ? cache : await updateCache();
  const missing = (readyCache as Cache & { missing?: number[] }).missing ?? [];

  const { counts, ranking, top6, next6, top18, hasData } = buildRanking(
    readyCache.draws.values(),
    includeBonus,
  );
  const latestDraw = readyCache.draws.get(readyCache.latest);

  return NextResponse.json({
    source: "dhlottery",
    updatedAt: new Date(readyCache.updatedAt).toISOString(),
    latestDraw: readyCache.latest,
    latestDate: latestDraw?.drwNoDate ?? null,
    totalDraws: readyCache.draws.size,
    includeBonus,
    counts,
    ranking,
    top6,
    next6,
    top18,
    hasData,
    missingDraws: missing,
    apiBlockedUntil: readyCache.blockedUntil ?? null,
  });
}
