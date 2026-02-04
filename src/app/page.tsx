"use client";

import { useCallback, useMemo, useState } from "react";
import styles from "./page.module.css";
import QrScanner from "./_components/QrScanner";

type RankingItem = {
  num: number;
  count: number;
};

type AlgoMode = "weighted" | "balanced" | "filtered" | "probabilistic";

const IMAGE_COUNTS: RankingItem[] = [
  { num: 34, count: 181 },
  { num: 12, count: 177 },
  { num: 27, count: 176 },
  { num: 13, count: 174 },
  { num: 18, count: 172 },
  { num: 33, count: 172 },
  { num: 37, count: 171 },
  { num: 40, count: 171 },
  { num: 45, count: 171 },
  { num: 3, count: 169 },
  { num: 14, count: 169 },
  { num: 17, count: 168 },
  { num: 7, count: 167 },
  { num: 20, count: 167 },
  { num: 1, count: 166 },
  { num: 16, count: 166 },
  { num: 38, count: 166 },
  { num: 19, count: 165 },
  { num: 39, count: 165 },
  { num: 21, count: 164 },
  { num: 6, count: 163 },
  { num: 11, count: 163 },
  { num: 24, count: 163 },
  { num: 26, count: 163 },
  { num: 31, count: 163 },
  { num: 15, count: 162 },
  { num: 43, count: 162 },
  { num: 36, count: 161 },
  { num: 35, count: 160 },
  { num: 4, count: 159 },
  { num: 44, count: 159 },
  { num: 10, count: 158 },
  { num: 30, count: 155 },
  { num: 8, count: 154 },
  { num: 42, count: 153 },
  { num: 2, count: 152 },
  { num: 29, count: 152 },
  { num: 5, count: 151 },
  { num: 28, count: 151 },
  { num: 25, count: 148 },
  { num: 41, count: 146 },
  { num: 23, count: 145 },
  { num: 22, count: 141 },
  { num: 32, count: 141 },
  { num: 9, count: 132 },
];

function shuffle<T>(items: T[]) {
  const data = [...items];
  for (let i = data.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [data[i], data[j]] = [data[j], data[i]];
  }
  return data;
}

function weightedPick(
  counts: RankingItem[],
  size: number,
  power = 1.4,
) {
  const pool = counts.map((item) => ({
    num: item.num,
    weight: Math.max(1, item.count) ** power,
  }));
  const picked: number[] = [];
  const local = [...pool];
  for (let i = 0; i < size && local.length > 0; i += 1) {
    const total = local.reduce((sum, item) => sum + item.weight, 0);
    let r = Math.random() * total;
    let idx = 0;
    while (idx < local.length && r > local[idx].weight) {
      r -= local[idx].weight;
      idx += 1;
    }
    const chosen = local[Math.min(idx, local.length - 1)];
    picked.push(chosen.num);
    local.splice(Math.min(idx, local.length - 1), 1);
  }
  return picked.sort((a, b) => a - b);
}

function balancedPick(
  counts: RankingItem[],
  groupTargets = [1, 1, 1, 1, 2],
) {
  const groups: number[][] = [[], [], [], [], []];
  for (const item of counts) {
    const idx = Math.min(Math.floor((item.num - 1) / 10), 4);
    groups[idx].push(item.num);
  }
  const result: number[] = [];
  groupTargets.forEach((size, idx) => {
    const group = groups[idx];
    const shuffled = shuffle(group);
    result.push(...shuffled.slice(0, size));
  });
  return result.sort((a, b) => a - b).slice(0, 6);
}

function filteredPick(counts: RankingItem[]) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const pick = weightedPick(counts, 6, 1.2);
    const odds = pick.filter((n) => n % 2 === 1).length;
    const sum = pick.reduce((a, b) => a + b, 0);
    if (odds === 3 && sum >= 90 && sum <= 180) {
      return pick;
    }
  }
  return weightedPick(counts, 6, 1.1);
}

function probabilisticPick(counts: RankingItem[]) {
  return weightedPick(counts, 6, 1.0);
}

function buildRankingFromCounts(counts: RankingItem[]) {
  const fullCounts = Array.from({ length: 45 }, (_, index) => {
    const num = index + 1;
    const found = counts.find((item) => item.num === num);
    return {
      num,
      count: found?.count ?? 0,
    };
  });

  const ranking = [...fullCounts].sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return a.num - b.num;
  });

  const maxCount = ranking[0]?.count ?? 0;
  return {
    counts: fullCounts,
    ranking,
    hasData: maxCount > 0,
  };
}

function getBallClass(num: number) {
  if (num <= 10) {
    return styles.c1;
  }
  if (num <= 20) {
    return styles.c2;
  }
  if (num <= 30) {
    return styles.c3;
  }
  if (num <= 40) {
    return styles.c4;
  }
  return styles.c5;
}

export default function Home() {
  const [algoMode, setAlgoMode] = useState<AlgoMode>("weighted");
  const [algoPick, setAlgoPick] = useState<number[] | null>(null);

  const baseRanking = useMemo(
    () => buildRankingFromCounts(IMAGE_COUNTS).ranking,
    [],
  );

  const buildAlgoPick = useCallback(() => {
    const counts = baseRanking;
    switch (algoMode) {
      case "weighted":
        setAlgoPick(weightedPick(counts, 6));
        break;
      case "balanced":
        setAlgoPick(balancedPick(counts));
        break;
      case "filtered":
        setAlgoPick(filteredPick(counts));
        break;
      case "probabilistic":
        setAlgoPick(probabilisticPick(counts));
        break;
      default:
        setAlgoPick(weightedPick(counts, 6));
        break;
    }
  }, [algoMode, baseRanking]);

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <section className={styles.singleCard}>
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>통계 기반 추천</div>
              <div className={styles.cardHint}>알고리즘 선택 후 생성</div>
            </div>
            <div className={styles.algoButtons}>
              <button
                type="button"
                className={`${styles.toggle} ${
                  algoMode === "weighted" ? styles.toggleActive : ""
                }`}
                onClick={() => setAlgoMode("weighted")}
              >
                1. 가중치 추천
              </button>
              <button
                type="button"
                className={`${styles.toggle} ${
                  algoMode === "balanced" ? styles.toggleActive : ""
                }`}
                onClick={() => setAlgoMode("balanced")}
              >
                2. 구간 밸런스
              </button>
              <button
                type="button"
                className={`${styles.toggle} ${
                  algoMode === "filtered" ? styles.toggleActive : ""
                }`}
                onClick={() => setAlgoMode("filtered")}
              >
                3. 홀짝/합계필터
              </button>
              <button
                type="button"
                className={`${styles.toggle} ${
                  algoMode === "probabilistic" ? styles.toggleActive : ""
                }`}
                onClick={() => setAlgoMode("probabilistic")}
              >
                4. 임의 확률추천
              </button>
            </div>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={buildAlgoPick}
            >
              추천 생성
            </button>
            {algoPick ? (
              <div className={styles.numbers}>
                {algoPick.map((num) => (
                  <span
                    key={`algo-${num}`}
                    className={`${styles.ball} ${getBallClass(num)}`}
                  >
                    {num}
                  </span>
                ))}
              </div>
            ) : (
              <div className={styles.cardHint}>
                알고리즘을 선택하고 “추천 생성”을 눌러주세요.
              </div>
            )}
          </div>
        </section>

        <QrScanner />
      </div>
    </div>
  );
}
