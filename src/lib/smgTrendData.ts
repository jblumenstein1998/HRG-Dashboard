// Auto-generated from HRG SMG "TrendReport" exports (PAR/SMG guest satisfaction survey data).
// Weekly, per-store: overall/temperature/accuracy/friendliness/cleanliness/problem are percentages (0-100);
// count is the number of survey responses for that store/week. "Combined" is SMG's own combined-stores rollup.
// Source covers Week 1, 2025 - Week 26, 2026 for the 5 TN stores; 2025-W09 has no data (no report was generated that week).

export type SmgMetricKey = "overall" | "temperature" | "accuracy" | "friendliness" | "cleanliness" | "problem" | "count";

export type SmgStoreMetrics = {
  overall: number | null;
  temperature: number | null;
  accuracy: number | null;
  friendliness: number | null;
  cleanliness: number | null;
  problem: number | null;
  count: number | null;
};

export type SmgWeekPoint = {
  weekKey: string;
  label: string;
  stores: Record<string, SmgStoreMetrics>;
};

export const SMG_METRICS: { key: SmgMetricKey; label: string; isPercent: boolean }[] = [
  { key: "overall",      label: "Overall Satisfaction",  isPercent: true },
  { key: "temperature",  label: "Temperature of Food",   isPercent: true },
  { key: "accuracy",     label: "Accuracy of Order",     isPercent: true },
  { key: "friendliness", label: "Friendliness",          isPercent: true },
  { key: "cleanliness",  label: "Cleanliness",           isPercent: true },
  { key: "problem",      label: "Experienced Problem (Y/N)", isPercent: true },
  { key: "count",        label: "Survey Count",          isPercent: false },
];

export const SMG_STORES = ["Columbia", "Springfield", "White House", "Brentwood", "Spring Hill"] as const;

export const SMG_TREND_DATA: SmgWeekPoint[] = [
  {
    "label": "Week 1, 2025",
    "weekKey": "2025-W01",
    "stores": {
      "Combined": {
        "overall": 83,
        "count": 47,
        "temperature": 76.6,
        "accuracy": 89.4,
        "friendliness": 70.2,
        "cleanliness": 74.5,
        "problem": 2.1
      },
      "Columbia": {
        "overall": 92.3,
        "count": 13,
        "temperature": 76.9,
        "accuracy": 92.3,
        "friendliness": 76.9,
        "cleanliness": 84.6,
        "problem": 7.7
      },
      "Springfield": {
        "overall": 83.3,
        "count": 12,
        "temperature": 91.7,
        "accuracy": 100,
        "friendliness": 66.7,
        "cleanliness": 83.3,
        "problem": 0
      },
      "White House": {
        "overall": 80,
        "count": 10,
        "temperature": 80,
        "accuracy": 80,
        "friendliness": 70,
        "cleanliness": 60,
        "problem": 0
      },
      "Brentwood": {
        "overall": 100,
        "count": 1,
        "temperature": 0,
        "accuracy": 100,
        "friendliness": 0,
        "cleanliness": 0,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 72.7,
        "count": 11,
        "temperature": 63.6,
        "accuracy": 81.8,
        "friendliness": 72.7,
        "cleanliness": 72.7,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 2, 2025",
    "weekKey": "2025-W02",
    "stores": {
      "Combined": {
        "overall": 81.1,
        "count": 37,
        "temperature": 70.3,
        "accuracy": 86.5,
        "friendliness": 73,
        "cleanliness": 70.3,
        "problem": 2.7
      },
      "Columbia": {
        "overall": 66.7,
        "count": 9,
        "temperature": 55.6,
        "accuracy": 88.9,
        "friendliness": 66.7,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Springfield": {
        "overall": 66.7,
        "count": 9,
        "temperature": 66.7,
        "accuracy": 77.8,
        "friendliness": 66.7,
        "cleanliness": 55.6,
        "problem": 11.1
      },
      "White House": {
        "overall": 91.7,
        "count": 12,
        "temperature": 83.3,
        "accuracy": 91.7,
        "friendliness": 83.3,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Brentwood": {
        "overall": 100,
        "count": 1,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 100,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 100,
        "count": 6,
        "temperature": 66.7,
        "accuracy": 83.3,
        "friendliness": 66.7,
        "cleanliness": 100,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 3, 2025",
    "weekKey": "2025-W03",
    "stores": {
      "Combined": {
        "overall": 73.5,
        "count": 49,
        "temperature": 75.5,
        "accuracy": 81.6,
        "friendliness": 83.7,
        "cleanliness": 69.4,
        "problem": 6.1
      },
      "Columbia": {
        "overall": 75,
        "count": 12,
        "temperature": 75,
        "accuracy": 83.3,
        "friendliness": 91.7,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Springfield": {
        "overall": 85.7,
        "count": 14,
        "temperature": 92.9,
        "accuracy": 92.9,
        "friendliness": 92.9,
        "cleanliness": 78.6,
        "problem": 7.1
      },
      "White House": {
        "overall": 50,
        "count": 8,
        "temperature": 62.5,
        "accuracy": 62.5,
        "friendliness": 75,
        "cleanliness": 62.5,
        "problem": 12.5
      },
      "Brentwood": {
        "overall": 100,
        "count": 1,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 100,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 71.4,
        "count": 14,
        "temperature": 64.3,
        "accuracy": 78.6,
        "friendliness": 71.4,
        "cleanliness": 64.3,
        "problem": 7.1
      }
    }
  },
  {
    "label": "Week 4, 2025",
    "weekKey": "2025-W04",
    "stores": {
      "Combined": {
        "overall": 69.8,
        "count": 53,
        "temperature": 71.7,
        "accuracy": 73.6,
        "friendliness": 69.8,
        "cleanliness": 60.4,
        "problem": 5.7
      },
      "Columbia": {
        "overall": 71.4,
        "count": 14,
        "temperature": 78.6,
        "accuracy": 64.3,
        "friendliness": 71.4,
        "cleanliness": 64.3,
        "problem": 7.1
      },
      "Springfield": {
        "overall": 50,
        "count": 10,
        "temperature": 60,
        "accuracy": 70,
        "friendliness": 60,
        "cleanliness": 50,
        "problem": 0
      },
      "White House": {
        "overall": 87.5,
        "count": 8,
        "temperature": 75,
        "accuracy": 100,
        "friendliness": 87.5,
        "cleanliness": 62.5,
        "problem": 0
      },
      "Brentwood": {
        "overall": 100,
        "count": 4,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 100,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 64.7,
        "count": 17,
        "temperature": 64.7,
        "accuracy": 64.7,
        "friendliness": 58.8,
        "cleanliness": 52.9,
        "problem": 11.8
      }
    }
  },
  {
    "label": "Week 5, 2025",
    "weekKey": "2025-W05",
    "stores": {
      "Combined": {
        "overall": 75,
        "count": 44,
        "temperature": 72.7,
        "accuracy": 77.3,
        "friendliness": 77.3,
        "cleanliness": 65.9,
        "problem": 4.5
      },
      "Columbia": {
        "overall": 78.6,
        "count": 14,
        "temperature": 71.4,
        "accuracy": 71.4,
        "friendliness": 64.3,
        "cleanliness": 71.4,
        "problem": 0
      },
      "Springfield": {
        "overall": 90,
        "count": 10,
        "temperature": 90,
        "accuracy": 90,
        "friendliness": 90,
        "cleanliness": 70,
        "problem": 0
      },
      "White House": {
        "overall": 50,
        "count": 6,
        "temperature": 66.7,
        "accuracy": 66.7,
        "friendliness": 83.3,
        "cleanliness": 50,
        "problem": 16.7
      },
      "Brentwood": {
        "overall": 100,
        "count": 4,
        "temperature": 100,
        "accuracy": 75,
        "friendliness": 75,
        "cleanliness": 100,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 60,
        "count": 10,
        "temperature": 50,
        "accuracy": 80,
        "friendliness": 80,
        "cleanliness": 50,
        "problem": 10
      }
    }
  },
  {
    "label": "Week 6, 2025",
    "weekKey": "2025-W06",
    "stores": {
      "Combined": {
        "overall": 73.5,
        "count": 49,
        "temperature": 83.7,
        "accuracy": 79.6,
        "friendliness": 75.5,
        "cleanliness": 73.5,
        "problem": 12.2
      },
      "Columbia": {
        "overall": 72.2,
        "count": 18,
        "temperature": 77.8,
        "accuracy": 66.7,
        "friendliness": 72.2,
        "cleanliness": 72.2,
        "problem": 5.6
      },
      "Springfield": {
        "overall": 62.5,
        "count": 8,
        "temperature": 87.5,
        "accuracy": 87.5,
        "friendliness": 75,
        "cleanliness": 75,
        "problem": 25
      },
      "White House": {
        "overall": 83.3,
        "count": 6,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 100,
        "problem": 0
      },
      "Brentwood": {
        "overall": 80,
        "count": 5,
        "temperature": 80,
        "accuracy": 100,
        "friendliness": 80,
        "cleanliness": 80,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 75,
        "count": 12,
        "temperature": 83.3,
        "accuracy": 75,
        "friendliness": 66.7,
        "cleanliness": 58.3,
        "problem": 25
      }
    }
  },
  {
    "label": "Week 7, 2025",
    "weekKey": "2025-W07",
    "stores": {
      "Combined": {
        "overall": 84.1,
        "count": 44,
        "temperature": 77.3,
        "accuracy": 77.3,
        "friendliness": 75,
        "cleanliness": 59.1,
        "problem": 2.3
      },
      "Columbia": {
        "overall": 72.7,
        "count": 11,
        "temperature": 72.7,
        "accuracy": 72.7,
        "friendliness": 81.8,
        "cleanliness": 63.6,
        "problem": 0
      },
      "Springfield": {
        "overall": 77.8,
        "count": 9,
        "temperature": 77.8,
        "accuracy": 77.8,
        "friendliness": 66.7,
        "cleanliness": 44.4,
        "problem": 0
      },
      "White House": {
        "overall": 100,
        "count": 5,
        "temperature": 80,
        "accuracy": 60,
        "friendliness": 80,
        "cleanliness": 60,
        "problem": 20
      },
      "Brentwood": {
        "overall": 100,
        "count": 8,
        "temperature": 87.5,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 75,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 81.8,
        "count": 11,
        "temperature": 72.7,
        "accuracy": 72.7,
        "friendliness": 54.5,
        "cleanliness": 54.5,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 8, 2025",
    "weekKey": "2025-W08",
    "stores": {
      "Combined": {
        "overall": 84.4,
        "count": 45,
        "temperature": 82.2,
        "accuracy": 80,
        "friendliness": 77.8,
        "cleanliness": 71.1,
        "problem": 8.9
      },
      "Columbia": {
        "overall": 76.9,
        "count": 13,
        "temperature": 76.9,
        "accuracy": 76.9,
        "friendliness": 92.3,
        "cleanliness": 69.2,
        "problem": 23.1
      },
      "Springfield": {
        "overall": 66.7,
        "count": 3,
        "temperature": 66.7,
        "accuracy": 66.7,
        "friendliness": 66.7,
        "cleanliness": 66.7,
        "problem": 0
      },
      "White House": {
        "overall": 91.7,
        "count": 12,
        "temperature": 75,
        "accuracy": 83.3,
        "friendliness": 66.7,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Brentwood": {
        "overall": 100,
        "count": 3,
        "temperature": 100,
        "accuracy": 66.7,
        "friendliness": 100,
        "cleanliness": 100,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 85.7,
        "count": 14,
        "temperature": 92.9,
        "accuracy": 85.7,
        "friendliness": 71.4,
        "cleanliness": 71.4,
        "problem": 7.1
      }
    }
  },
  {
    "label": "Week 10, 2025",
    "weekKey": "2025-W10",
    "stores": {
      "Combined": {
        "overall": 76.4,
        "count": 55,
        "temperature": 72.7,
        "accuracy": 78.2,
        "friendliness": 72.7,
        "cleanliness": 65.5,
        "problem": 3.6
      },
      "Columbia": {
        "overall": 81,
        "count": 21,
        "temperature": 76.2,
        "accuracy": 85.7,
        "friendliness": 81,
        "cleanliness": 81,
        "problem": 9.5
      },
      "Springfield": {
        "overall": 77.8,
        "count": 9,
        "temperature": 77.8,
        "accuracy": 77.8,
        "friendliness": 77.8,
        "cleanliness": 66.7,
        "problem": 0
      },
      "White House": {
        "overall": 75,
        "count": 8,
        "temperature": 75,
        "accuracy": 75,
        "friendliness": 75,
        "cleanliness": 75,
        "problem": 0
      },
      "Brentwood": {
        "overall": 80,
        "count": 5,
        "temperature": 60,
        "accuracy": 80,
        "friendliness": 80,
        "cleanliness": 60,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 66.7,
        "count": 12,
        "temperature": 66.7,
        "accuracy": 66.7,
        "friendliness": 50,
        "cleanliness": 33.3,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 11, 2025",
    "weekKey": "2025-W11",
    "stores": {
      "Combined": {
        "overall": 69.6,
        "count": 46,
        "temperature": 71.7,
        "accuracy": 71.7,
        "friendliness": 67.4,
        "cleanliness": 65.2,
        "problem": 8.7
      },
      "Columbia": {
        "overall": 50,
        "count": 12,
        "temperature": 66.7,
        "accuracy": 66.7,
        "friendliness": 58.3,
        "cleanliness": 58.3,
        "problem": 8.3
      },
      "Springfield": {
        "overall": 100,
        "count": 9,
        "temperature": 100,
        "accuracy": 88.9,
        "friendliness": 88.9,
        "cleanliness": 77.8,
        "problem": 0
      },
      "White House": {
        "overall": 58.3,
        "count": 12,
        "temperature": 58.3,
        "accuracy": 58.3,
        "friendliness": 58.3,
        "cleanliness": 58.3,
        "problem": 0
      },
      "Brentwood": {
        "overall": 75,
        "count": 4,
        "temperature": 75,
        "accuracy": 75,
        "friendliness": 75,
        "cleanliness": 75,
        "problem": 25
      },
      "Spring Hill": {
        "overall": 77.8,
        "count": 9,
        "temperature": 66.7,
        "accuracy": 77.8,
        "friendliness": 66.7,
        "cleanliness": 66.7,
        "problem": 22.2
      }
    }
  },
  {
    "label": "Week 12, 2025",
    "weekKey": "2025-W12",
    "stores": {
      "Combined": {
        "overall": 74.1,
        "count": 58,
        "temperature": 70.7,
        "accuracy": 77.6,
        "friendliness": 74.1,
        "cleanliness": 60.3,
        "problem": 1.7
      },
      "Columbia": {
        "overall": 86.7,
        "count": 15,
        "temperature": 80,
        "accuracy": 86.7,
        "friendliness": 73.3,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Springfield": {
        "overall": 73.3,
        "count": 15,
        "temperature": 80,
        "accuracy": 86.7,
        "friendliness": 80,
        "cleanliness": 60,
        "problem": 0
      },
      "White House": {
        "overall": 83.3,
        "count": 6,
        "temperature": 83.3,
        "accuracy": 66.7,
        "friendliness": 83.3,
        "cleanliness": 83.3,
        "problem": 0
      },
      "Brentwood": {
        "overall": 71.4,
        "count": 7,
        "temperature": 71.4,
        "accuracy": 71.4,
        "friendliness": 85.7,
        "cleanliness": 71.4,
        "problem": 14.3
      },
      "Spring Hill": {
        "overall": 60,
        "count": 15,
        "temperature": 46.7,
        "accuracy": 66.7,
        "friendliness": 60,
        "cleanliness": 40,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 13, 2025",
    "weekKey": "2025-W13",
    "stores": {
      "Combined": {
        "overall": 86.7,
        "count": 44,
        "temperature": 86.7,
        "accuracy": 91.1,
        "friendliness": 88.9,
        "cleanliness": 82.2,
        "problem": 2.3
      },
      "Columbia": {
        "overall": 92.3,
        "count": 12,
        "temperature": 92.3,
        "accuracy": 92.3,
        "friendliness": 92.3,
        "cleanliness": 84.6,
        "problem": 0
      },
      "Springfield": {
        "overall": 90,
        "count": 10,
        "temperature": 80,
        "accuracy": 90,
        "friendliness": 90,
        "cleanliness": 80,
        "problem": 0
      },
      "White House": {
        "overall": 100,
        "count": 7,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 85.7,
        "problem": 0
      },
      "Brentwood": {
        "overall": 100,
        "count": 2,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 100,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 69.2,
        "count": 13,
        "temperature": 76.9,
        "accuracy": 84.6,
        "friendliness": 76.9,
        "cleanliness": 76.9,
        "problem": 7.7
      }
    }
  },
  {
    "label": "Week 14, 2025",
    "weekKey": "2025-W14",
    "stores": {
      "Combined": {
        "overall": 70.5,
        "count": 61,
        "temperature": 63.9,
        "accuracy": 72.1,
        "friendliness": 68.9,
        "cleanliness": 60.7,
        "problem": 1.6
      },
      "Columbia": {
        "overall": 61.5,
        "count": 13,
        "temperature": 61.5,
        "accuracy": 76.9,
        "friendliness": 61.5,
        "cleanliness": 53.8,
        "problem": 0
      },
      "Springfield": {
        "overall": 81.8,
        "count": 11,
        "temperature": 63.6,
        "accuracy": 72.7,
        "friendliness": 72.7,
        "cleanliness": 63.6,
        "problem": 0
      },
      "White House": {
        "overall": 76.9,
        "count": 13,
        "temperature": 76.9,
        "accuracy": 76.9,
        "friendliness": 84.6,
        "cleanliness": 69.2,
        "problem": 7.7
      },
      "Brentwood": {
        "overall": 83.3,
        "count": 6,
        "temperature": 50,
        "accuracy": 50,
        "friendliness": 66.7,
        "cleanliness": 50,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 61.1,
        "count": 18,
        "temperature": 61.1,
        "accuracy": 72.2,
        "friendliness": 61.1,
        "cleanliness": 61.1,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 15, 2025",
    "weekKey": "2025-W15",
    "stores": {
      "Combined": {
        "overall": 71.1,
        "count": 45,
        "temperature": 66.7,
        "accuracy": 77.8,
        "friendliness": 66.7,
        "cleanliness": 55.6,
        "problem": 6.7
      },
      "Columbia": {
        "overall": 76.9,
        "count": 13,
        "temperature": 69.2,
        "accuracy": 76.9,
        "friendliness": 61.5,
        "cleanliness": 38.5,
        "problem": 0
      },
      "Springfield": {
        "overall": 70,
        "count": 10,
        "temperature": 60,
        "accuracy": 70,
        "friendliness": 70,
        "cleanliness": 50,
        "problem": 10
      },
      "White House": {
        "overall": 60,
        "count": 10,
        "temperature": 70,
        "accuracy": 80,
        "friendliness": 70,
        "cleanliness": 70,
        "problem": 10
      },
      "Brentwood": {
        "overall": 83.3,
        "count": 6,
        "temperature": 66.7,
        "accuracy": 83.3,
        "friendliness": 66.7,
        "cleanliness": 66.7,
        "problem": 16.7
      },
      "Spring Hill": {
        "overall": 66.7,
        "count": 6,
        "temperature": 66.7,
        "accuracy": 83.3,
        "friendliness": 66.7,
        "cleanliness": 66.7,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 16, 2025",
    "weekKey": "2025-W16",
    "stores": {
      "Combined": {
        "overall": 81.6,
        "count": 49,
        "temperature": 81.6,
        "accuracy": 87.8,
        "friendliness": 81.6,
        "cleanliness": 81.6,
        "problem": 2
      },
      "Columbia": {
        "overall": 84.2,
        "count": 19,
        "temperature": 78.9,
        "accuracy": 89.5,
        "friendliness": 84.2,
        "cleanliness": 84.2,
        "problem": 0
      },
      "Springfield": {
        "overall": 88.9,
        "count": 9,
        "temperature": 88.9,
        "accuracy": 100,
        "friendliness": 77.8,
        "cleanliness": 88.9,
        "problem": 0
      },
      "White House": {
        "overall": 75,
        "count": 8,
        "temperature": 87.5,
        "accuracy": 75,
        "friendliness": 87.5,
        "cleanliness": 87.5,
        "problem": 12.5
      },
      "Brentwood": {
        "overall": 80,
        "count": 5,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 100,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 75,
        "count": 8,
        "temperature": 62.5,
        "accuracy": 75,
        "friendliness": 62.5,
        "cleanliness": 50,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 17, 2025",
    "weekKey": "2025-W17",
    "stores": {
      "Combined": {
        "overall": 60.4,
        "count": 48,
        "temperature": 62.5,
        "accuracy": 72.9,
        "friendliness": 64.6,
        "cleanliness": 58.3,
        "problem": 2.1
      },
      "Columbia": {
        "overall": 72.2,
        "count": 18,
        "temperature": 72.2,
        "accuracy": 77.8,
        "friendliness": 77.8,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Springfield": {
        "overall": 37.5,
        "count": 8,
        "temperature": 75,
        "accuracy": 62.5,
        "friendliness": 37.5,
        "cleanliness": 62.5,
        "problem": 12.5
      },
      "White House": {
        "overall": 66.7,
        "count": 6,
        "temperature": 50,
        "accuracy": 83.3,
        "friendliness": 66.7,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Brentwood": {
        "overall": 100,
        "count": 1,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 100,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 53.3,
        "count": 15,
        "temperature": 46.7,
        "accuracy": 66.7,
        "friendliness": 60,
        "cleanliness": 40,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 18, 2025",
    "weekKey": "2025-W18",
    "stores": {
      "Combined": {
        "overall": 73.8,
        "count": 65,
        "temperature": 75.4,
        "accuracy": 78.5,
        "friendliness": 75.4,
        "cleanliness": 64.6,
        "problem": 4.6
      },
      "Columbia": {
        "overall": 81,
        "count": 21,
        "temperature": 81,
        "accuracy": 81,
        "friendliness": 76.2,
        "cleanliness": 61.9,
        "problem": 4.8
      },
      "Springfield": {
        "overall": 63.6,
        "count": 11,
        "temperature": 81.8,
        "accuracy": 81.8,
        "friendliness": 81.8,
        "cleanliness": 63.6,
        "problem": 0
      },
      "White House": {
        "overall": 72.7,
        "count": 11,
        "temperature": 72.7,
        "accuracy": 63.6,
        "friendliness": 63.6,
        "cleanliness": 63.6,
        "problem": 9.1
      },
      "Brentwood": {
        "overall": 72.7,
        "count": 11,
        "temperature": 63.6,
        "accuracy": 72.7,
        "friendliness": 63.6,
        "cleanliness": 63.6,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 72.7,
        "count": 11,
        "temperature": 72.7,
        "accuracy": 90.9,
        "friendliness": 90.9,
        "cleanliness": 72.7,
        "problem": 9.1
      }
    }
  },
  {
    "label": "Week 19, 2025",
    "weekKey": "2025-W19",
    "stores": {
      "Combined": {
        "overall": 72.2,
        "count": 72,
        "temperature": 70.8,
        "accuracy": 76.4,
        "friendliness": 70.8,
        "cleanliness": 66.7,
        "problem": 9.7
      },
      "Columbia": {
        "overall": 89.5,
        "count": 19,
        "temperature": 89.5,
        "accuracy": 84.2,
        "friendliness": 89.5,
        "cleanliness": 78.9,
        "problem": 5.3
      },
      "Springfield": {
        "overall": 57.1,
        "count": 7,
        "temperature": 57.1,
        "accuracy": 57.1,
        "friendliness": 57.1,
        "cleanliness": 42.9,
        "problem": 28.6
      },
      "White House": {
        "overall": 77.8,
        "count": 18,
        "temperature": 88.9,
        "accuracy": 83.3,
        "friendliness": 66.7,
        "cleanliness": 77.8,
        "problem": 5.6
      },
      "Brentwood": {
        "overall": 42.9,
        "count": 7,
        "temperature": 28.6,
        "accuracy": 57.1,
        "friendliness": 14.3,
        "cleanliness": 42.9,
        "problem": 14.3
      },
      "Spring Hill": {
        "overall": 66.7,
        "count": 21,
        "temperature": 57.1,
        "accuracy": 76.2,
        "friendliness": 81,
        "cleanliness": 61.9,
        "problem": 9.5
      }
    }
  },
  {
    "label": "Week 20, 2025",
    "weekKey": "2025-W20",
    "stores": {
      "Combined": {
        "overall": 66.1,
        "count": 56,
        "temperature": 69.6,
        "accuracy": 75,
        "friendliness": 66.1,
        "cleanliness": 62.5,
        "problem": 1.8
      },
      "Columbia": {
        "overall": 62.5,
        "count": 16,
        "temperature": 56.3,
        "accuracy": 56.3,
        "friendliness": 56.3,
        "cleanliness": 56.3,
        "problem": 6.3
      },
      "Springfield": {
        "overall": 80,
        "count": 15,
        "temperature": 86.7,
        "accuracy": 86.7,
        "friendliness": 80,
        "cleanliness": 80,
        "problem": 0
      },
      "White House": {
        "overall": 57.1,
        "count": 14,
        "temperature": 71.4,
        "accuracy": 78.6,
        "friendliness": 64.3,
        "cleanliness": 50,
        "problem": 0
      },
      "Brentwood": {
        "overall": 100,
        "count": 2,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 100,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 55.6,
        "count": 9,
        "temperature": 55.6,
        "accuracy": 77.8,
        "friendliness": 55.6,
        "cleanliness": 55.6,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 21, 2025",
    "weekKey": "2025-W21",
    "stores": {
      "Combined": {
        "overall": 80.9,
        "count": 68,
        "temperature": 76.5,
        "accuracy": 76.5,
        "friendliness": 76.5,
        "cleanliness": 69.1,
        "problem": 7.4
      },
      "Columbia": {
        "overall": 85.7,
        "count": 21,
        "temperature": 81,
        "accuracy": 85.7,
        "friendliness": 81,
        "cleanliness": 66.7,
        "problem": 9.5
      },
      "Springfield": {
        "overall": 100,
        "count": 10,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 90,
        "cleanliness": 90,
        "problem": 0
      },
      "White House": {
        "overall": 66.7,
        "count": 12,
        "temperature": 75,
        "accuracy": 58.3,
        "friendliness": 66.7,
        "cleanliness": 83.3,
        "problem": 8.3
      },
      "Brentwood": {
        "overall": 80,
        "count": 10,
        "temperature": 50,
        "accuracy": 70,
        "friendliness": 70,
        "cleanliness": 50,
        "problem": 10
      },
      "Spring Hill": {
        "overall": 73.3,
        "count": 15,
        "temperature": 73.3,
        "accuracy": 66.7,
        "friendliness": 73.3,
        "cleanliness": 60,
        "problem": 6.7
      }
    }
  },
  {
    "label": "Week 22, 2025",
    "weekKey": "2025-W22",
    "stores": {
      "Combined": {
        "overall": 75,
        "count": 72,
        "temperature": 73.6,
        "accuracy": 79.2,
        "friendliness": 72.2,
        "cleanliness": 75,
        "problem": 4.2
      },
      "Columbia": {
        "overall": 81.5,
        "count": 27,
        "temperature": 81.5,
        "accuracy": 85.2,
        "friendliness": 81.5,
        "cleanliness": 77.8,
        "problem": 3.7
      },
      "Springfield": {
        "overall": 85.7,
        "count": 7,
        "temperature": 85.7,
        "accuracy": 85.7,
        "friendliness": 85.7,
        "cleanliness": 85.7,
        "problem": 0
      },
      "White House": {
        "overall": 88.9,
        "count": 18,
        "temperature": 83.3,
        "accuracy": 94.4,
        "friendliness": 77.8,
        "cleanliness": 94.4,
        "problem": 0
      },
      "Brentwood": {
        "overall": 37.5,
        "count": 8,
        "temperature": 50,
        "accuracy": 37.5,
        "friendliness": 37.5,
        "cleanliness": 50,
        "problem": 25
      },
      "Spring Hill": {
        "overall": 58.3,
        "count": 12,
        "temperature": 50,
        "accuracy": 66.7,
        "friendliness": 58.3,
        "cleanliness": 50,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 23, 2025",
    "weekKey": "2025-W23",
    "stores": {
      "Combined": {
        "overall": 68.8,
        "count": 48,
        "temperature": 66.7,
        "accuracy": 75,
        "friendliness": 72.9,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Columbia": {
        "overall": 58.3,
        "count": 12,
        "temperature": 58.3,
        "accuracy": 83.3,
        "friendliness": 83.3,
        "cleanliness": 58.3,
        "problem": 0
      },
      "Springfield": {
        "overall": 66.7,
        "count": 12,
        "temperature": 75,
        "accuracy": 75,
        "friendliness": 66.7,
        "cleanliness": 66.7,
        "problem": 0
      },
      "White House": {
        "overall": 90.9,
        "count": 11,
        "temperature": 81.8,
        "accuracy": 81.8,
        "friendliness": 81.8,
        "cleanliness": 81.8,
        "problem": 0
      },
      "Brentwood": {
        "overall": 66.7,
        "count": 6,
        "temperature": 66.7,
        "accuracy": 66.7,
        "friendliness": 66.7,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 57.1,
        "count": 7,
        "temperature": 42.9,
        "accuracy": 57.1,
        "friendliness": 57.1,
        "cleanliness": 57.1,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 24, 2025",
    "weekKey": "2025-W24",
    "stores": {
      "Combined": {
        "overall": 70.8,
        "count": 65,
        "temperature": 73.8,
        "accuracy": 76.9,
        "friendliness": 69.2,
        "cleanliness": 63.1,
        "problem": 3.1
      },
      "Columbia": {
        "overall": 75,
        "count": 20,
        "temperature": 80,
        "accuracy": 80,
        "friendliness": 80,
        "cleanliness": 65,
        "problem": 10
      },
      "Springfield": {
        "overall": 100,
        "count": 5,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 80,
        "problem": 0
      },
      "White House": {
        "overall": 83.3,
        "count": 12,
        "temperature": 75,
        "accuracy": 83.3,
        "friendliness": 66.7,
        "cleanliness": 75,
        "problem": 0
      },
      "Brentwood": {
        "overall": 55.6,
        "count": 9,
        "temperature": 88.9,
        "accuracy": 77.8,
        "friendliness": 77.8,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 57.9,
        "count": 19,
        "temperature": 52.6,
        "accuracy": 63.2,
        "friendliness": 47.4,
        "cleanliness": 47.4,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 25, 2025",
    "weekKey": "2025-W25",
    "stores": {
      "Combined": {
        "overall": 73.3,
        "count": 45,
        "temperature": 84.4,
        "accuracy": 88.9,
        "friendliness": 71.1,
        "cleanliness": 73.3,
        "problem": 4.4
      },
      "Columbia": {
        "overall": 69.2,
        "count": 13,
        "temperature": 76.9,
        "accuracy": 76.9,
        "friendliness": 76.9,
        "cleanliness": 76.9,
        "problem": 7.7
      },
      "Springfield": {
        "overall": 76.9,
        "count": 13,
        "temperature": 92.3,
        "accuracy": 84.6,
        "friendliness": 61.5,
        "cleanliness": 69.2,
        "problem": 7.7
      },
      "White House": {
        "overall": 100,
        "count": 5,
        "temperature": 80,
        "accuracy": 100,
        "friendliness": 40,
        "cleanliness": 60,
        "problem": 0
      },
      "Brentwood": {
        "overall": 75,
        "count": 4,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 100,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 60,
        "count": 10,
        "temperature": 80,
        "accuracy": 100,
        "friendliness": 80,
        "cleanliness": 70,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 26, 2025",
    "weekKey": "2025-W26",
    "stores": {
      "Combined": {
        "overall": 87.7,
        "count": 57,
        "temperature": 89.5,
        "accuracy": 87.7,
        "friendliness": 86,
        "cleanliness": 82.5,
        "problem": 5.3
      },
      "Columbia": {
        "overall": 93.8,
        "count": 16,
        "temperature": 100,
        "accuracy": 93.8,
        "friendliness": 93.8,
        "cleanliness": 87.5,
        "problem": 0
      },
      "Springfield": {
        "overall": 85.7,
        "count": 7,
        "temperature": 85.7,
        "accuracy": 71.4,
        "friendliness": 85.7,
        "cleanliness": 71.4,
        "problem": 14.3
      },
      "White House": {
        "overall": 90,
        "count": 10,
        "temperature": 80,
        "accuracy": 80,
        "friendliness": 70,
        "cleanliness": 90,
        "problem": 0
      },
      "Brentwood": {
        "overall": 83.3,
        "count": 6,
        "temperature": 83.3,
        "accuracy": 83.3,
        "friendliness": 83.3,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 83.3,
        "count": 18,
        "temperature": 88.9,
        "accuracy": 94.4,
        "friendliness": 88.9,
        "cleanliness": 83.3,
        "problem": 11.1
      }
    }
  },
  {
    "label": "Week 27, 2025",
    "weekKey": "2025-W27",
    "stores": {
      "Combined": {
        "overall": 75,
        "count": 56,
        "temperature": 82.1,
        "accuracy": 83.9,
        "friendliness": 71.4,
        "cleanliness": 64.3,
        "problem": 7.1
      },
      "Columbia": {
        "overall": 76.5,
        "count": 17,
        "temperature": 76.5,
        "accuracy": 82.4,
        "friendliness": 70.6,
        "cleanliness": 58.8,
        "problem": 0
      },
      "Springfield": {
        "overall": 87.5,
        "count": 8,
        "temperature": 75,
        "accuracy": 87.5,
        "friendliness": 75,
        "cleanliness": 75,
        "problem": 12.5
      },
      "White House": {
        "overall": 81.8,
        "count": 11,
        "temperature": 90.9,
        "accuracy": 90.9,
        "friendliness": 63.6,
        "cleanliness": 72.7,
        "problem": 9.1
      },
      "Brentwood": {
        "overall": 66.7,
        "count": 3,
        "temperature": 66.7,
        "accuracy": 66.7,
        "friendliness": 66.7,
        "cleanliness": 66.7,
        "problem": 33.3
      },
      "Spring Hill": {
        "overall": 64.7,
        "count": 17,
        "temperature": 88.2,
        "accuracy": 82.4,
        "friendliness": 76.5,
        "cleanliness": 58.8,
        "problem": 5.9
      }
    }
  },
  {
    "label": "Week 28, 2025",
    "weekKey": "2025-W28",
    "stores": {
      "Combined": {
        "overall": 76.2,
        "count": 63,
        "temperature": 82.5,
        "accuracy": 87.3,
        "friendliness": 77.8,
        "cleanliness": 71.4,
        "problem": 1.6
      },
      "Columbia": {
        "overall": 75,
        "count": 16,
        "temperature": 75,
        "accuracy": 100,
        "friendliness": 75,
        "cleanliness": 68.8,
        "problem": 0
      },
      "Springfield": {
        "overall": 66.7,
        "count": 12,
        "temperature": 83.3,
        "accuracy": 83.3,
        "friendliness": 75,
        "cleanliness": 75,
        "problem": 0
      },
      "White House": {
        "overall": 100,
        "count": 14,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 92.9,
        "cleanliness": 85.7,
        "problem": 0
      },
      "Brentwood": {
        "overall": 57.1,
        "count": 7,
        "temperature": 71.4,
        "accuracy": 57.1,
        "friendliness": 57.1,
        "cleanliness": 57.1,
        "problem": 14.3
      },
      "Spring Hill": {
        "overall": 71.4,
        "count": 14,
        "temperature": 78.6,
        "accuracy": 78.6,
        "friendliness": 78.6,
        "cleanliness": 64.3,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 29, 2025",
    "weekKey": "2025-W29",
    "stores": {
      "Combined": {
        "overall": 85.7,
        "count": 56,
        "temperature": 85.7,
        "accuracy": 83.9,
        "friendliness": 87.5,
        "cleanliness": 73.2,
        "problem": 1.8
      },
      "Columbia": {
        "overall": 100,
        "count": 19,
        "temperature": 94.7,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 89.5,
        "problem": 0
      },
      "Springfield": {
        "overall": 75,
        "count": 8,
        "temperature": 75,
        "accuracy": 75,
        "friendliness": 75,
        "cleanliness": 75,
        "problem": 12.5
      },
      "White House": {
        "overall": 100,
        "count": 9,
        "temperature": 100,
        "accuracy": 77.8,
        "friendliness": 88.9,
        "cleanliness": 55.6,
        "problem": 0
      },
      "Brentwood": {
        "overall": 75,
        "count": 4,
        "temperature": 50,
        "accuracy": 75,
        "friendliness": 75,
        "cleanliness": 50,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 68.8,
        "count": 16,
        "temperature": 81.3,
        "accuracy": 75,
        "friendliness": 81.3,
        "cleanliness": 68.8,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 30, 2025",
    "weekKey": "2025-W30",
    "stores": {
      "Combined": {
        "overall": 76.4,
        "count": 72,
        "temperature": 80.6,
        "accuracy": 83.3,
        "friendliness": 73.6,
        "cleanliness": 72.2,
        "problem": 8.3
      },
      "Columbia": {
        "overall": 76.5,
        "count": 17,
        "temperature": 82.4,
        "accuracy": 88.2,
        "friendliness": 76.5,
        "cleanliness": 70.6,
        "problem": 5.9
      },
      "Springfield": {
        "overall": 81.8,
        "count": 11,
        "temperature": 90.9,
        "accuracy": 90.9,
        "friendliness": 81.8,
        "cleanliness": 90.9,
        "problem": 0
      },
      "White House": {
        "overall": 75,
        "count": 12,
        "temperature": 58.3,
        "accuracy": 66.7,
        "friendliness": 50,
        "cleanliness": 66.7,
        "problem": 16.7
      },
      "Brentwood": {
        "overall": 66.7,
        "count": 18,
        "temperature": 83.3,
        "accuracy": 77.8,
        "friendliness": 72.2,
        "cleanliness": 66.7,
        "problem": 5.6
      },
      "Spring Hill": {
        "overall": 85.7,
        "count": 14,
        "temperature": 85.7,
        "accuracy": 92.9,
        "friendliness": 85.7,
        "cleanliness": 71.4,
        "problem": 14.3
      }
    }
  },
  {
    "label": "Week 31, 2025",
    "weekKey": "2025-W31",
    "stores": {
      "Combined": {
        "overall": 70.3,
        "count": 64,
        "temperature": 73.4,
        "accuracy": 75,
        "friendliness": 65.6,
        "cleanliness": 59.4,
        "problem": 9.4
      },
      "Columbia": {
        "overall": 66.7,
        "count": 21,
        "temperature": 81,
        "accuracy": 76.2,
        "friendliness": 66.7,
        "cleanliness": 61.9,
        "problem": 9.5
      },
      "Springfield": {
        "overall": 100,
        "count": 10,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 90,
        "cleanliness": 90,
        "problem": 0
      },
      "White House": {
        "overall": 60,
        "count": 10,
        "temperature": 40,
        "accuracy": 50,
        "friendliness": 60,
        "cleanliness": 30,
        "problem": 10
      },
      "Brentwood": {
        "overall": 75,
        "count": 4,
        "temperature": 75,
        "accuracy": 75,
        "friendliness": 75,
        "cleanliness": 75,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 63.2,
        "count": 19,
        "temperature": 68.4,
        "accuracy": 73.7,
        "friendliness": 52.6,
        "cleanliness": 52.6,
        "problem": 15.8
      }
    }
  },
  {
    "label": "Week 32, 2025",
    "weekKey": "2025-W32",
    "stores": {
      "Combined": {
        "overall": 81.1,
        "count": 53,
        "temperature": 73.6,
        "accuracy": 83,
        "friendliness": 73.6,
        "cleanliness": 69.8,
        "problem": 1.9
      },
      "Columbia": {
        "overall": 90,
        "count": 20,
        "temperature": 75,
        "accuracy": 85,
        "friendliness": 75,
        "cleanliness": 70,
        "problem": 0
      },
      "Springfield": {
        "overall": 50,
        "count": 6,
        "temperature": 50,
        "accuracy": 66.7,
        "friendliness": 66.7,
        "cleanliness": 66.7,
        "problem": 16.7
      },
      "White House": {
        "overall": 100,
        "count": 6,
        "temperature": 83.3,
        "accuracy": 100,
        "friendliness": 83.3,
        "cleanliness": 100,
        "problem": 0
      },
      "Brentwood": {
        "overall": 75,
        "count": 4,
        "temperature": 75,
        "accuracy": 100,
        "friendliness": 75,
        "cleanliness": 75,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 76.5,
        "count": 17,
        "temperature": 76.5,
        "accuracy": 76.5,
        "friendliness": 70.6,
        "cleanliness": 58.8,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 33, 2025",
    "weekKey": "2025-W33",
    "stores": {
      "Combined": {
        "overall": 66,
        "count": 47,
        "temperature": 57.4,
        "accuracy": 66,
        "friendliness": 57.4,
        "cleanliness": 51.1,
        "problem": 2.1
      },
      "Columbia": {
        "overall": 56.3,
        "count": 16,
        "temperature": 56.3,
        "accuracy": 62.5,
        "friendliness": 50,
        "cleanliness": 50,
        "problem": 6.3
      },
      "Springfield": {
        "overall": 88.9,
        "count": 9,
        "temperature": 88.9,
        "accuracy": 88.9,
        "friendliness": 77.8,
        "cleanliness": 66.7,
        "problem": 0
      },
      "White House": {
        "overall": 50,
        "count": 2,
        "temperature": 50,
        "accuracy": 50,
        "friendliness": 50,
        "cleanliness": 0,
        "problem": 0
      },
      "Brentwood": {
        "overall": 75,
        "count": 4,
        "temperature": 75,
        "accuracy": 75,
        "friendliness": 50,
        "cleanliness": 75,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 62.5,
        "count": 16,
        "temperature": 37.5,
        "accuracy": 56.3,
        "friendliness": 56.3,
        "cleanliness": 43.8,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 34, 2025",
    "weekKey": "2025-W34",
    "stores": {
      "Combined": {
        "overall": 67.4,
        "count": 43,
        "temperature": 69.8,
        "accuracy": 74.4,
        "friendliness": 72.1,
        "cleanliness": 67.4,
        "problem": 11.6
      },
      "Columbia": {
        "overall": 87.5,
        "count": 8,
        "temperature": 87.5,
        "accuracy": 87.5,
        "friendliness": 87.5,
        "cleanliness": 87.5,
        "problem": 12.5
      },
      "Springfield": {
        "overall": 37.5,
        "count": 8,
        "temperature": 37.5,
        "accuracy": 62.5,
        "friendliness": 62.5,
        "cleanliness": 37.5,
        "problem": 25
      },
      "White House": {
        "overall": 62.5,
        "count": 8,
        "temperature": 75,
        "accuracy": 75,
        "friendliness": 75,
        "cleanliness": 62.5,
        "problem": 0
      },
      "Brentwood": {
        "overall": 75,
        "count": 8,
        "temperature": 75,
        "accuracy": 75,
        "friendliness": 75,
        "cleanliness": 75,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 72.7,
        "count": 11,
        "temperature": 72.7,
        "accuracy": 72.7,
        "friendliness": 63.6,
        "cleanliness": 72.7,
        "problem": 18.2
      }
    }
  },
  {
    "label": "Week 35, 2025",
    "weekKey": "2025-W35",
    "stores": {
      "Combined": {
        "overall": 78,
        "count": 50,
        "temperature": 76,
        "accuracy": 82,
        "friendliness": 70,
        "cleanliness": 68,
        "problem": 0
      },
      "Columbia": {
        "overall": 88.2,
        "count": 17,
        "temperature": 82.4,
        "accuracy": 82.4,
        "friendliness": 76.5,
        "cleanliness": 70.6,
        "problem": 0
      },
      "Springfield": {
        "overall": 70,
        "count": 10,
        "temperature": 90,
        "accuracy": 80,
        "friendliness": 70,
        "cleanliness": 70,
        "problem": 0
      },
      "White House": {
        "overall": 72.7,
        "count": 11,
        "temperature": 63.6,
        "accuracy": 72.7,
        "friendliness": 54.5,
        "cleanliness": 54.5,
        "problem": 0
      },
      "Brentwood": {
        "overall": 100,
        "count": 1,
        "temperature": 0,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 100,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 72.7,
        "count": 11,
        "temperature": 72.7,
        "accuracy": 90.9,
        "friendliness": 72.7,
        "cleanliness": 72.7,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 36, 2025",
    "weekKey": "2025-W36",
    "stores": {
      "Combined": {
        "overall": 71.9,
        "count": 57,
        "temperature": 66.7,
        "accuracy": 77.2,
        "friendliness": 73.7,
        "cleanliness": 61.4,
        "problem": 7
      },
      "Columbia": {
        "overall": 83.3,
        "count": 18,
        "temperature": 83.3,
        "accuracy": 83.3,
        "friendliness": 77.8,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Springfield": {
        "overall": 100,
        "count": 9,
        "temperature": 88.9,
        "accuracy": 88.9,
        "friendliness": 88.9,
        "cleanliness": 88.9,
        "problem": 0
      },
      "White House": {
        "overall": 88.9,
        "count": 9,
        "temperature": 77.8,
        "accuracy": 88.9,
        "friendliness": 88.9,
        "cleanliness": 77.8,
        "problem": 11.1
      },
      "Brentwood": {
        "overall": 33.3,
        "count": 3,
        "temperature": 66.7,
        "accuracy": 33.3,
        "friendliness": 100,
        "cleanliness": 66.7,
        "problem": 33.3
      },
      "Spring Hill": {
        "overall": 44.4,
        "count": 18,
        "temperature": 33.3,
        "accuracy": 66.7,
        "friendliness": 50,
        "cleanliness": 33.3,
        "problem": 11.1
      }
    }
  },
  {
    "label": "Week 37, 2025",
    "weekKey": "2025-W37",
    "stores": {
      "Combined": {
        "overall": 79,
        "count": 81,
        "temperature": 79,
        "accuracy": 79,
        "friendliness": 80.2,
        "cleanliness": 65.4,
        "problem": 1.2
      },
      "Columbia": {
        "overall": 85.7,
        "count": 14,
        "temperature": 85.7,
        "accuracy": 78.6,
        "friendliness": 64.3,
        "cleanliness": 64.3,
        "problem": 0
      },
      "Springfield": {
        "overall": 75,
        "count": 36,
        "temperature": 75,
        "accuracy": 77.8,
        "friendliness": 86.1,
        "cleanliness": 61.1,
        "problem": 0
      },
      "White House": {
        "overall": 80,
        "count": 15,
        "temperature": 93.3,
        "accuracy": 80,
        "friendliness": 86.7,
        "cleanliness": 86.7,
        "problem": 0
      },
      "Brentwood": {
        "overall": 50,
        "count": 2,
        "temperature": 50,
        "accuracy": 50,
        "friendliness": 50,
        "cleanliness": 50,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 85.7,
        "count": 14,
        "temperature": 71.4,
        "accuracy": 85.7,
        "friendliness": 78.6,
        "cleanliness": 57.1,
        "problem": 7.1
      }
    }
  },
  {
    "label": "Week 38, 2025",
    "weekKey": "2025-W38",
    "stores": {
      "Combined": {
        "overall": 82.3,
        "count": 96,
        "temperature": 81.2,
        "accuracy": 88.5,
        "friendliness": 86.5,
        "cleanliness": 78.1,
        "problem": 3.1
      },
      "Columbia": {
        "overall": 77.8,
        "count": 18,
        "temperature": 72.2,
        "accuracy": 88.9,
        "friendliness": 83.3,
        "cleanliness": 77.8,
        "problem": 11.1
      },
      "Springfield": {
        "overall": 95.1,
        "count": 41,
        "temperature": 87.8,
        "accuracy": 87.8,
        "friendliness": 92.7,
        "cleanliness": 75.6,
        "problem": 0
      },
      "White House": {
        "overall": 68.8,
        "count": 16,
        "temperature": 87.5,
        "accuracy": 93.8,
        "friendliness": 87.5,
        "cleanliness": 87.5,
        "problem": 0
      },
      "Brentwood": {
        "overall": 25,
        "count": 4,
        "temperature": 0,
        "accuracy": 75,
        "friendliness": 50,
        "cleanliness": 75,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 82.4,
        "count": 17,
        "temperature": 88.2,
        "accuracy": 88.2,
        "friendliness": 82.4,
        "cleanliness": 76.5,
        "problem": 5.9
      }
    }
  },
  {
    "label": "Week 39, 2025",
    "weekKey": "2025-W39",
    "stores": {
      "Combined": {
        "overall": 85,
        "count": 80,
        "temperature": 82.5,
        "accuracy": 86.3,
        "friendliness": 78.7,
        "cleanliness": 73.7,
        "problem": 2.5
      },
      "Columbia": {
        "overall": 83.3,
        "count": 18,
        "temperature": 83.3,
        "accuracy": 88.9,
        "friendliness": 83.3,
        "cleanliness": 72.2,
        "problem": 5.6
      },
      "Springfield": {
        "overall": 84.4,
        "count": 32,
        "temperature": 78.1,
        "accuracy": 84.4,
        "friendliness": 71.9,
        "cleanliness": 71.9,
        "problem": 3.1
      },
      "White House": {
        "overall": 100,
        "count": 11,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 100,
        "problem": 0
      },
      "Brentwood": {
        "overall": 71.4,
        "count": 7,
        "temperature": 71.4,
        "accuracy": 71.4,
        "friendliness": 57.1,
        "cleanliness": 71.4,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 83.3,
        "count": 12,
        "temperature": 83.3,
        "accuracy": 83.3,
        "friendliness": 83.3,
        "cleanliness": 58.3,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 40, 2025",
    "weekKey": "2025-W40",
    "stores": {
      "Combined": {
        "overall": 73.9,
        "count": 69,
        "temperature": 72.5,
        "accuracy": 79.7,
        "friendliness": 72.5,
        "cleanliness": 71,
        "problem": 4.3
      },
      "Columbia": {
        "overall": 86.4,
        "count": 22,
        "temperature": 81.8,
        "accuracy": 72.7,
        "friendliness": 68.2,
        "cleanliness": 72.7,
        "problem": 4.5
      },
      "Springfield": {
        "overall": 66.7,
        "count": 9,
        "temperature": 77.8,
        "accuracy": 77.8,
        "friendliness": 66.7,
        "cleanliness": 66.7,
        "problem": 11.1
      },
      "White House": {
        "overall": 81.8,
        "count": 22,
        "temperature": 72.7,
        "accuracy": 81.8,
        "friendliness": 81.8,
        "cleanliness": 72.7,
        "problem": 0
      },
      "Brentwood": {
        "overall": 62.5,
        "count": 8,
        "temperature": 62.5,
        "accuracy": 87.5,
        "friendliness": 87.5,
        "cleanliness": 75,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 37.5,
        "count": 8,
        "temperature": 50,
        "accuracy": 87.5,
        "friendliness": 50,
        "cleanliness": 62.5,
        "problem": 12.5
      }
    }
  },
  {
    "label": "Week 41, 2025",
    "weekKey": "2025-W41",
    "stores": {
      "Combined": {
        "overall": 74.6,
        "count": 67,
        "temperature": 80.6,
        "accuracy": 83.6,
        "friendliness": 82.1,
        "cleanliness": 74.6,
        "problem": 7.5
      },
      "Columbia": {
        "overall": 85.7,
        "count": 14,
        "temperature": 100,
        "accuracy": 92.9,
        "friendliness": 85.7,
        "cleanliness": 78.6,
        "problem": 7.1
      },
      "Springfield": {
        "overall": 72,
        "count": 25,
        "temperature": 80,
        "accuracy": 84,
        "friendliness": 88,
        "cleanliness": 72,
        "problem": 4
      },
      "White House": {
        "overall": 84.6,
        "count": 13,
        "temperature": 92.3,
        "accuracy": 92.3,
        "friendliness": 84.6,
        "cleanliness": 92.3,
        "problem": 0
      },
      "Brentwood": {
        "overall": 60,
        "count": 5,
        "temperature": 60,
        "accuracy": 80,
        "friendliness": 60,
        "cleanliness": 80,
        "problem": 20
      },
      "Spring Hill": {
        "overall": 60,
        "count": 10,
        "temperature": 50,
        "accuracy": 60,
        "friendliness": 70,
        "cleanliness": 50,
        "problem": 20
      }
    }
  },
  {
    "label": "Week 42, 2025",
    "weekKey": "2025-W42",
    "stores": {
      "Combined": {
        "overall": 79.2,
        "count": 77,
        "temperature": 72.7,
        "accuracy": 84.4,
        "friendliness": 84.4,
        "cleanliness": 68.8,
        "problem": 1.3
      },
      "Columbia": {
        "overall": 88.2,
        "count": 17,
        "temperature": 82.4,
        "accuracy": 94.1,
        "friendliness": 88.2,
        "cleanliness": 76.5,
        "problem": 0
      },
      "Springfield": {
        "overall": 85.7,
        "count": 21,
        "temperature": 81,
        "accuracy": 85.7,
        "friendliness": 90.5,
        "cleanliness": 81,
        "problem": 0
      },
      "White House": {
        "overall": 77.8,
        "count": 18,
        "temperature": 83.3,
        "accuracy": 83.3,
        "friendliness": 77.8,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Brentwood": {
        "overall": 66.7,
        "count": 3,
        "temperature": 66.7,
        "accuracy": 66.7,
        "friendliness": 100,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 66.7,
        "count": 18,
        "temperature": 44.4,
        "accuracy": 77.8,
        "friendliness": 77.8,
        "cleanliness": 50,
        "problem": 5.6
      }
    }
  },
  {
    "label": "Week 43, 2025",
    "weekKey": "2025-W43",
    "stores": {
      "Combined": {
        "overall": 81.5,
        "count": 65,
        "temperature": 78.5,
        "accuracy": 84.6,
        "friendliness": 81.5,
        "cleanliness": 78.5,
        "problem": 1.5
      },
      "Columbia": {
        "overall": 90,
        "count": 10,
        "temperature": 60,
        "accuracy": 100,
        "friendliness": 90,
        "cleanliness": 70,
        "problem": 0
      },
      "Springfield": {
        "overall": 82.6,
        "count": 23,
        "temperature": 87,
        "accuracy": 87,
        "friendliness": 87,
        "cleanliness": 87,
        "problem": 4.3
      },
      "White House": {
        "overall": 85.7,
        "count": 14,
        "temperature": 78.6,
        "accuracy": 78.6,
        "friendliness": 71.4,
        "cleanliness": 78.6,
        "problem": 0
      },
      "Brentwood": {
        "overall": 75,
        "count": 4,
        "temperature": 75,
        "accuracy": 75,
        "friendliness": 75,
        "cleanliness": 50,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 71.4,
        "count": 14,
        "temperature": 78.6,
        "accuracy": 78.6,
        "friendliness": 78.6,
        "cleanliness": 78.6,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 44, 2025",
    "weekKey": "2025-W44",
    "stores": {
      "Combined": {
        "overall": 72.7,
        "count": 66,
        "temperature": 71.2,
        "accuracy": 80.3,
        "friendliness": 65.2,
        "cleanliness": 65.2,
        "problem": 1.5
      },
      "Columbia": {
        "overall": 66.7,
        "count": 24,
        "temperature": 62.5,
        "accuracy": 79.2,
        "friendliness": 58.3,
        "cleanliness": 54.2,
        "problem": 0
      },
      "Springfield": {
        "overall": 93.8,
        "count": 16,
        "temperature": 87.5,
        "accuracy": 93.8,
        "friendliness": 87.5,
        "cleanliness": 93.8,
        "problem": 0
      },
      "White House": {
        "overall": 71.4,
        "count": 7,
        "temperature": 85.7,
        "accuracy": 71.4,
        "friendliness": 57.1,
        "cleanliness": 57.1,
        "problem": 0
      },
      "Brentwood": {
        "overall": 60,
        "count": 5,
        "temperature": 80,
        "accuracy": 80,
        "friendliness": 60,
        "cleanliness": 80,
        "problem": 20
      },
      "Spring Hill": {
        "overall": 64.3,
        "count": 14,
        "temperature": 57.1,
        "accuracy": 71.4,
        "friendliness": 57.1,
        "cleanliness": 50,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 45, 2025",
    "weekKey": "2025-W45",
    "stores": {
      "Combined": {
        "overall": 77,
        "count": 73,
        "temperature": 82.4,
        "accuracy": 86.5,
        "friendliness": 85.1,
        "cleanliness": 78.4,
        "problem": 8.2
      },
      "Columbia": {
        "overall": 85.7,
        "count": 13,
        "temperature": 85.7,
        "accuracy": 85.7,
        "friendliness": 92.9,
        "cleanliness": 85.7,
        "problem": 0
      },
      "Springfield": {
        "overall": 76.2,
        "count": 21,
        "temperature": 71.4,
        "accuracy": 81,
        "friendliness": 76.2,
        "cleanliness": 76.2,
        "problem": 14.3
      },
      "White House": {
        "overall": 76.9,
        "count": 13,
        "temperature": 92.3,
        "accuracy": 100,
        "friendliness": 92.3,
        "cleanliness": 76.9,
        "problem": 7.7
      },
      "Brentwood": {
        "overall": 80,
        "count": 5,
        "temperature": 80,
        "accuracy": 80,
        "friendliness": 80,
        "cleanliness": 80,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 71.4,
        "count": 21,
        "temperature": 85.7,
        "accuracy": 85.7,
        "friendliness": 85.7,
        "cleanliness": 76.2,
        "problem": 9.5
      }
    }
  },
  {
    "label": "Week 46, 2025",
    "weekKey": "2025-W46",
    "stores": {
      "Combined": {
        "overall": 87.5,
        "count": 80,
        "temperature": 87.5,
        "accuracy": 87.5,
        "friendliness": 88.7,
        "cleanliness": 87.5,
        "problem": 3.8
      },
      "Columbia": {
        "overall": 95.7,
        "count": 23,
        "temperature": 91.3,
        "accuracy": 95.7,
        "friendliness": 95.7,
        "cleanliness": 91.3,
        "problem": 0
      },
      "Springfield": {
        "overall": 87.5,
        "count": 24,
        "temperature": 87.5,
        "accuracy": 83.3,
        "friendliness": 91.7,
        "cleanliness": 91.7,
        "problem": 4.2
      },
      "White House": {
        "overall": 70.6,
        "count": 17,
        "temperature": 76.5,
        "accuracy": 76.5,
        "friendliness": 70.6,
        "cleanliness": 70.6,
        "problem": 5.9
      },
      "Brentwood": {
        "overall": 100,
        "count": 2,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 100,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 92.9,
        "count": 14,
        "temperature": 92.9,
        "accuracy": 92.9,
        "friendliness": 92.9,
        "cleanliness": 92.9,
        "problem": 7.1
      }
    }
  },
  {
    "label": "Week 47, 2025",
    "weekKey": "2025-W47",
    "stores": {
      "Combined": {
        "overall": 77.1,
        "count": 70,
        "temperature": 68.6,
        "accuracy": 80,
        "friendliness": 82.9,
        "cleanliness": 70,
        "problem": 7.1
      },
      "Columbia": {
        "overall": 76.9,
        "count": 26,
        "temperature": 69.2,
        "accuracy": 84.6,
        "friendliness": 80.8,
        "cleanliness": 80.8,
        "problem": 0
      },
      "Springfield": {
        "overall": 75,
        "count": 12,
        "temperature": 75,
        "accuracy": 75,
        "friendliness": 83.3,
        "cleanliness": 66.7,
        "problem": 0
      },
      "White House": {
        "overall": 76.5,
        "count": 17,
        "temperature": 70.6,
        "accuracy": 70.6,
        "friendliness": 82.4,
        "cleanliness": 58.8,
        "problem": 11.8
      },
      "Brentwood": {
        "overall": 66.7,
        "count": 6,
        "temperature": 33.3,
        "accuracy": 83.3,
        "friendliness": 83.3,
        "cleanliness": 50,
        "problem": 33.3
      },
      "Spring Hill": {
        "overall": 88.9,
        "count": 9,
        "temperature": 77.8,
        "accuracy": 88.9,
        "friendliness": 88.9,
        "cleanliness": 77.8,
        "problem": 11.1
      }
    }
  },
  {
    "label": "Week 48, 2025",
    "weekKey": "2025-W48",
    "stores": {
      "Combined": {
        "overall": 84,
        "count": 50,
        "temperature": 82,
        "accuracy": 84,
        "friendliness": 88,
        "cleanliness": 74,
        "problem": 6
      },
      "Columbia": {
        "overall": 87.5,
        "count": 16,
        "temperature": 87.5,
        "accuracy": 81.3,
        "friendliness": 93.8,
        "cleanliness": 87.5,
        "problem": 0
      },
      "Springfield": {
        "overall": 91.7,
        "count": 12,
        "temperature": 83.3,
        "accuracy": 91.7,
        "friendliness": 91.7,
        "cleanliness": 75,
        "problem": 0
      },
      "White House": {
        "overall": 75,
        "count": 8,
        "temperature": 75,
        "accuracy": 87.5,
        "friendliness": 75,
        "cleanliness": 62.5,
        "problem": 25
      },
      "Brentwood": {
        "overall": 33.3,
        "count": 3,
        "temperature": 33.3,
        "accuracy": 33.3,
        "friendliness": 33.3,
        "cleanliness": 33.3,
        "problem": 33.3
      },
      "Spring Hill": {
        "overall": 90.9,
        "count": 11,
        "temperature": 90.9,
        "accuracy": 90.9,
        "friendliness": 100,
        "cleanliness": 72.7,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 49, 2025",
    "weekKey": "2025-W49",
    "stores": {
      "Combined": {
        "overall": 75.8,
        "count": 66,
        "temperature": 75.8,
        "accuracy": 81.8,
        "friendliness": 78.8,
        "cleanliness": 71.2,
        "problem": 6.1
      },
      "Columbia": {
        "overall": 75,
        "count": 24,
        "temperature": 87.5,
        "accuracy": 87.5,
        "friendliness": 79.2,
        "cleanliness": 75,
        "problem": 8.3
      },
      "Springfield": {
        "overall": 75,
        "count": 16,
        "temperature": 75,
        "accuracy": 75,
        "friendliness": 68.8,
        "cleanliness": 56.3,
        "problem": 6.3
      },
      "White House": {
        "overall": 81.8,
        "count": 11,
        "temperature": 63.6,
        "accuracy": 81.8,
        "friendliness": 81.8,
        "cleanliness": 81.8,
        "problem": 9.1
      },
      "Brentwood": {
        "overall": 50,
        "count": 4,
        "temperature": 50,
        "accuracy": 50,
        "friendliness": 75,
        "cleanliness": 75,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 81.8,
        "count": 11,
        "temperature": 72.7,
        "accuracy": 90.9,
        "friendliness": 90.9,
        "cleanliness": 72.7,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 50, 2025",
    "weekKey": "2025-W50",
    "stores": {
      "Combined": {
        "overall": 80.3,
        "count": 71,
        "temperature": 78.9,
        "accuracy": 83.1,
        "friendliness": 76.1,
        "cleanliness": 73.2,
        "problem": 1.4
      },
      "Columbia": {
        "overall": 64.7,
        "count": 17,
        "temperature": 64.7,
        "accuracy": 64.7,
        "friendliness": 58.8,
        "cleanliness": 58.8,
        "problem": 5.9
      },
      "Springfield": {
        "overall": 100,
        "count": 20,
        "temperature": 95,
        "accuracy": 100,
        "friendliness": 80,
        "cleanliness": 85,
        "problem": 0
      },
      "White House": {
        "overall": 76.5,
        "count": 17,
        "temperature": 70.6,
        "accuracy": 76.5,
        "friendliness": 76.5,
        "cleanliness": 76.5,
        "problem": 0
      },
      "Brentwood": {
        "overall": 66.7,
        "count": 6,
        "temperature": 66.7,
        "accuracy": 83.3,
        "friendliness": 100,
        "cleanliness": 50,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 81.8,
        "count": 11,
        "temperature": 90.9,
        "accuracy": 90.9,
        "friendliness": 81.8,
        "cleanliness": 81.8,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 51, 2025",
    "weekKey": "2025-W51",
    "stores": {
      "Combined": {
        "overall": 80.7,
        "count": 57,
        "temperature": 75.4,
        "accuracy": 84.2,
        "friendliness": 80.7,
        "cleanliness": 70.2,
        "problem": 3.5
      },
      "Columbia": {
        "overall": 82.4,
        "count": 17,
        "temperature": 70.6,
        "accuracy": 88.2,
        "friendliness": 76.5,
        "cleanliness": 70.6,
        "problem": 5.9
      },
      "Springfield": {
        "overall": 82.4,
        "count": 17,
        "temperature": 82.4,
        "accuracy": 88.2,
        "friendliness": 82.4,
        "cleanliness": 88.2,
        "problem": 5.9
      },
      "White House": {
        "overall": 91.7,
        "count": 12,
        "temperature": 83.3,
        "accuracy": 83.3,
        "friendliness": 91.7,
        "cleanliness": 58.3,
        "problem": 0
      },
      "Brentwood": {
        "overall": 50,
        "count": 6,
        "temperature": 50,
        "accuracy": 66.7,
        "friendliness": 66.7,
        "cleanliness": 33.3,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 80,
        "count": 5,
        "temperature": 80,
        "accuracy": 80,
        "friendliness": 80,
        "cleanliness": 80,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 52, 2025",
    "weekKey": "2025-W52",
    "stores": {
      "Combined": {
        "overall": 80,
        "count": 45,
        "temperature": 77.8,
        "accuracy": 82.2,
        "friendliness": 82.2,
        "cleanliness": 77.8,
        "problem": 2.2
      },
      "Columbia": {
        "overall": 77.8,
        "count": 9,
        "temperature": 77.8,
        "accuracy": 77.8,
        "friendliness": 77.8,
        "cleanliness": 77.8,
        "problem": 0
      },
      "Springfield": {
        "overall": 80,
        "count": 15,
        "temperature": 86.7,
        "accuracy": 93.3,
        "friendliness": 93.3,
        "cleanliness": 86.7,
        "problem": 0
      },
      "White House": {
        "overall": 90,
        "count": 10,
        "temperature": 100,
        "accuracy": 80,
        "friendliness": 90,
        "cleanliness": 100,
        "problem": 10
      },
      "Brentwood": {
        "overall": 100,
        "count": 2,
        "temperature": 0,
        "accuracy": 50,
        "friendliness": 50,
        "cleanliness": 0,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 66.7,
        "count": 9,
        "temperature": 55.6,
        "accuracy": 77.8,
        "friendliness": 66.7,
        "cleanliness": 55.6,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 1, 2026",
    "weekKey": "2026-W01",
    "stores": {
      "Combined": {
        "overall": 77.8,
        "count": 63,
        "temperature": 76.2,
        "accuracy": 81,
        "friendliness": 73,
        "cleanliness": 73,
        "problem": 6.3
      },
      "Columbia": {
        "overall": 66.7,
        "count": 15,
        "temperature": 60,
        "accuracy": 60,
        "friendliness": 53.3,
        "cleanliness": 60,
        "problem": 13.3
      },
      "Springfield": {
        "overall": 72.7,
        "count": 11,
        "temperature": 63.6,
        "accuracy": 63.6,
        "friendliness": 63.6,
        "cleanliness": 63.6,
        "problem": 9.1
      },
      "White House": {
        "overall": 90.5,
        "count": 21,
        "temperature": 95.2,
        "accuracy": 95.2,
        "friendliness": 90.5,
        "cleanliness": 85.7,
        "problem": 0
      },
      "Brentwood": {
        "overall": 85.7,
        "count": 7,
        "temperature": 71.4,
        "accuracy": 85.7,
        "friendliness": 71.4,
        "cleanliness": 71.4,
        "problem": 14.3
      },
      "Spring Hill": {
        "overall": 66.7,
        "count": 9,
        "temperature": 77.8,
        "accuracy": 100,
        "friendliness": 77.8,
        "cleanliness": 77.8,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 2, 2026",
    "weekKey": "2026-W02",
    "stores": {
      "Combined": {
        "overall": 77.9,
        "count": 68,
        "temperature": 73.5,
        "accuracy": 83.8,
        "friendliness": 70.6,
        "cleanliness": 67.6,
        "problem": 7.4
      },
      "Columbia": {
        "overall": 84.2,
        "count": 19,
        "temperature": 68.4,
        "accuracy": 84.2,
        "friendliness": 63.2,
        "cleanliness": 73.7,
        "problem": 5.3
      },
      "Springfield": {
        "overall": 61.9,
        "count": 21,
        "temperature": 66.7,
        "accuracy": 71.4,
        "friendliness": 66.7,
        "cleanliness": 61.9,
        "problem": 14.3
      },
      "White House": {
        "overall": 90,
        "count": 10,
        "temperature": 90,
        "accuracy": 100,
        "friendliness": 90,
        "cleanliness": 80,
        "problem": 0
      },
      "Brentwood": {
        "overall": 100,
        "count": 6,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 83.3,
        "cleanliness": 50,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 75,
        "count": 12,
        "temperature": 66.7,
        "accuracy": 83.3,
        "friendliness": 66.7,
        "cleanliness": 66.7,
        "problem": 8.3
      }
    }
  },
  {
    "label": "Week 3, 2026",
    "weekKey": "2026-W03",
    "stores": {
      "Combined": {
        "overall": 75.7,
        "count": 70,
        "temperature": 74.3,
        "accuracy": 82.9,
        "friendliness": 81.4,
        "cleanliness": 68.6,
        "problem": 8.6
      },
      "Columbia": {
        "overall": 76.5,
        "count": 17,
        "temperature": 70.6,
        "accuracy": 88.2,
        "friendliness": 82.4,
        "cleanliness": 70.6,
        "problem": 5.9
      },
      "Springfield": {
        "overall": 85.7,
        "count": 14,
        "temperature": 85.7,
        "accuracy": 92.9,
        "friendliness": 92.9,
        "cleanliness": 57.1,
        "problem": 7.1
      },
      "White House": {
        "overall": 81.8,
        "count": 11,
        "temperature": 63.6,
        "accuracy": 81.8,
        "friendliness": 81.8,
        "cleanliness": 54.5,
        "problem": 0
      },
      "Brentwood": {
        "overall": 77.8,
        "count": 9,
        "temperature": 77.8,
        "accuracy": 100,
        "friendliness": 88.9,
        "cleanliness": 88.9,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 63.2,
        "count": 19,
        "temperature": 73.7,
        "accuracy": 63.2,
        "friendliness": 68.4,
        "cleanliness": 73.7,
        "problem": 21.1
      }
    }
  },
  {
    "label": "Week 4, 2026",
    "weekKey": "2026-W04",
    "stores": {
      "Combined": {
        "overall": 88.3,
        "count": 60,
        "temperature": 83.3,
        "accuracy": 90,
        "friendliness": 83.3,
        "cleanliness": 85,
        "problem": 3.3
      },
      "Columbia": {
        "overall": 91.7,
        "count": 24,
        "temperature": 75,
        "accuracy": 91.7,
        "friendliness": 87.5,
        "cleanliness": 87.5,
        "problem": 0
      },
      "Springfield": {
        "overall": 87.5,
        "count": 16,
        "temperature": 87.5,
        "accuracy": 87.5,
        "friendliness": 81.3,
        "cleanliness": 81.3,
        "problem": 0
      },
      "White House": {
        "overall": 83.3,
        "count": 6,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 66.7,
        "cleanliness": 83.3,
        "problem": 0
      },
      "Brentwood": {
        "overall": 100,
        "count": 3,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 100,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 81.8,
        "count": 11,
        "temperature": 81.8,
        "accuracy": 81.8,
        "friendliness": 81.8,
        "cleanliness": 81.8,
        "problem": 18.2
      }
    }
  },
  {
    "label": "Week 5, 2026",
    "weekKey": "2026-W05",
    "stores": {
      "Combined": {
        "overall": 80.4,
        "count": 56,
        "temperature": 85.7,
        "accuracy": 89.3,
        "friendliness": 71.4,
        "cleanliness": 71.4,
        "problem": 5.4
      },
      "Columbia": {
        "overall": 91.7,
        "count": 12,
        "temperature": 100,
        "accuracy": 91.7,
        "friendliness": 83.3,
        "cleanliness": 83.3,
        "problem": 0
      },
      "Springfield": {
        "overall": 100,
        "count": 4,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 100,
        "problem": 0
      },
      "White House": {
        "overall": 66.7,
        "count": 9,
        "temperature": 77.8,
        "accuracy": 88.9,
        "friendliness": 55.6,
        "cleanliness": 44.4,
        "problem": 0
      },
      "Brentwood": {
        "overall": 80,
        "count": 5,
        "temperature": 80,
        "accuracy": 80,
        "friendliness": 80,
        "cleanliness": 60,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 76.9,
        "count": 26,
        "temperature": 80.8,
        "accuracy": 88.5,
        "friendliness": 65.4,
        "cleanliness": 73.1,
        "problem": 11.5
      }
    }
  },
  {
    "label": "Week 6, 2026",
    "weekKey": "2026-W06",
    "stores": {
      "Combined": {
        "overall": 82.8,
        "count": 64,
        "temperature": 78.1,
        "accuracy": 73.4,
        "friendliness": 75,
        "cleanliness": 73.4,
        "problem": 6.2
      },
      "Columbia": {
        "overall": 70.4,
        "count": 27,
        "temperature": 70.4,
        "accuracy": 70.4,
        "friendliness": 63,
        "cleanliness": 66.7,
        "problem": 7.4
      },
      "Springfield": {
        "overall": 92.3,
        "count": 13,
        "temperature": 84.6,
        "accuracy": 76.9,
        "friendliness": 76.9,
        "cleanliness": 76.9,
        "problem": 0
      },
      "White House": {
        "overall": 100,
        "count": 10,
        "temperature": 100,
        "accuracy": 80,
        "friendliness": 90,
        "cleanliness": 90,
        "problem": 0
      },
      "Brentwood": {
        "overall": 100,
        "count": 5,
        "temperature": 80,
        "accuracy": 80,
        "friendliness": 100,
        "cleanliness": 80,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 77.8,
        "count": 9,
        "temperature": 66.7,
        "accuracy": 66.7,
        "friendliness": 77.8,
        "cleanliness": 66.7,
        "problem": 22.2
      }
    }
  },
  {
    "label": "Week 7, 2026",
    "weekKey": "2026-W07",
    "stores": {
      "Combined": {
        "overall": 73.2,
        "count": 82,
        "temperature": 74.4,
        "accuracy": 73.2,
        "friendliness": 78,
        "cleanliness": 70.7,
        "problem": 7.3
      },
      "Columbia": {
        "overall": 90,
        "count": 20,
        "temperature": 80,
        "accuracy": 85,
        "friendliness": 80,
        "cleanliness": 85,
        "problem": 5
      },
      "Springfield": {
        "overall": 84.6,
        "count": 13,
        "temperature": 69.2,
        "accuracy": 69.2,
        "friendliness": 69.2,
        "cleanliness": 76.9,
        "problem": 0
      },
      "White House": {
        "overall": 58.8,
        "count": 17,
        "temperature": 76.5,
        "accuracy": 58.8,
        "friendliness": 58.8,
        "cleanliness": 47.1,
        "problem": 5.9
      },
      "Brentwood": {
        "overall": 100,
        "count": 6,
        "temperature": 66.7,
        "accuracy": 66.7,
        "friendliness": 100,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 57.7,
        "count": 26,
        "temperature": 73.1,
        "accuracy": 76.9,
        "friendliness": 88.5,
        "cleanliness": 73.1,
        "problem": 15.4
      }
    }
  },
  {
    "label": "Week 8, 2026",
    "weekKey": "2026-W08",
    "stores": {
      "Combined": {
        "overall": 80,
        "count": 90,
        "temperature": 76.7,
        "accuracy": 83.3,
        "friendliness": 73.3,
        "cleanliness": 70,
        "problem": 3.3
      },
      "Columbia": {
        "overall": 81.8,
        "count": 22,
        "temperature": 68.2,
        "accuracy": 77.3,
        "friendliness": 59.1,
        "cleanliness": 59.1,
        "problem": 4.5
      },
      "Springfield": {
        "overall": 85.7,
        "count": 21,
        "temperature": 81,
        "accuracy": 95.2,
        "friendliness": 81,
        "cleanliness": 81,
        "problem": 0
      },
      "White House": {
        "overall": 76,
        "count": 25,
        "temperature": 84,
        "accuracy": 88,
        "friendliness": 76,
        "cleanliness": 72,
        "problem": 4
      },
      "Brentwood": {
        "overall": 60,
        "count": 5,
        "temperature": 40,
        "accuracy": 60,
        "friendliness": 60,
        "cleanliness": 40,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 82.4,
        "count": 17,
        "temperature": 82.4,
        "accuracy": 76.5,
        "friendliness": 82.4,
        "cleanliness": 76.5,
        "problem": 5.9
      }
    }
  },
  {
    "label": "Week 9, 2026",
    "weekKey": "2026-W09",
    "stores": {
      "Combined": {
        "overall": 78.1,
        "count": 73,
        "temperature": 76.4,
        "accuracy": 82.2,
        "friendliness": 79.2,
        "cleanliness": 71.2,
        "problem": 4.1
      },
      "Columbia": {
        "overall": 82.4,
        "count": 17,
        "temperature": 75,
        "accuracy": 76.5,
        "friendliness": 81.3,
        "cleanliness": 82.4,
        "problem": 5.9
      },
      "Springfield": {
        "overall": 85.7,
        "count": 21,
        "temperature": 90.5,
        "accuracy": 90.5,
        "friendliness": 85.7,
        "cleanliness": 66.7,
        "problem": 4.8
      },
      "White House": {
        "overall": 75,
        "count": 16,
        "temperature": 75,
        "accuracy": 81.3,
        "friendliness": 81.3,
        "cleanliness": 75,
        "problem": 6.3
      },
      "Brentwood": {
        "overall": 66.7,
        "count": 6,
        "temperature": 66.7,
        "accuracy": 66.7,
        "friendliness": 66.7,
        "cleanliness": 50,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 69.2,
        "count": 13,
        "temperature": 61.5,
        "accuracy": 84.6,
        "friendliness": 69.2,
        "cleanliness": 69.2,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 10, 2026",
    "weekKey": "2026-W10",
    "stores": {
      "Combined": {
        "overall": 77.6,
        "count": 76,
        "temperature": 76.3,
        "accuracy": 77.6,
        "friendliness": 81.6,
        "cleanliness": 71.1,
        "problem": 6.6
      },
      "Columbia": {
        "overall": 87.5,
        "count": 16,
        "temperature": 81.3,
        "accuracy": 81.3,
        "friendliness": 87.5,
        "cleanliness": 75,
        "problem": 0
      },
      "Springfield": {
        "overall": 66.7,
        "count": 18,
        "temperature": 77.8,
        "accuracy": 77.8,
        "friendliness": 88.9,
        "cleanliness": 61.1,
        "problem": 0
      },
      "White House": {
        "overall": 75,
        "count": 12,
        "temperature": 66.7,
        "accuracy": 66.7,
        "friendliness": 75,
        "cleanliness": 75,
        "problem": 16.7
      },
      "Brentwood": {
        "overall": 60,
        "count": 10,
        "temperature": 70,
        "accuracy": 70,
        "friendliness": 80,
        "cleanliness": 70,
        "problem": 20
      },
      "Spring Hill": {
        "overall": 90,
        "count": 20,
        "temperature": 80,
        "accuracy": 85,
        "friendliness": 75,
        "cleanliness": 75,
        "problem": 5
      }
    }
  },
  {
    "label": "Week 11, 2026",
    "weekKey": "2026-W11",
    "stores": {
      "Combined": {
        "overall": 78.8,
        "count": 85,
        "temperature": 78.8,
        "accuracy": 88.2,
        "friendliness": 80,
        "cleanliness": 74.1,
        "problem": 3.5
      },
      "Columbia": {
        "overall": 73.7,
        "count": 19,
        "temperature": 78.9,
        "accuracy": 78.9,
        "friendliness": 78.9,
        "cleanliness": 73.7,
        "problem": 10.5
      },
      "Springfield": {
        "overall": 90.9,
        "count": 11,
        "temperature": 81.8,
        "accuracy": 100,
        "friendliness": 72.7,
        "cleanliness": 72.7,
        "problem": 0
      },
      "White House": {
        "overall": 91.7,
        "count": 12,
        "temperature": 83.3,
        "accuracy": 100,
        "friendliness": 91.7,
        "cleanliness": 83.3,
        "problem": 0
      },
      "Brentwood": {
        "overall": 68,
        "count": 25,
        "temperature": 80,
        "accuracy": 84,
        "friendliness": 76,
        "cleanliness": 72,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 83.3,
        "count": 18,
        "temperature": 72.2,
        "accuracy": 88.9,
        "friendliness": 83.3,
        "cleanliness": 72.2,
        "problem": 5.6
      }
    }
  },
  {
    "label": "Week 12, 2026",
    "weekKey": "2026-W12",
    "stores": {
      "Combined": {
        "overall": 79.3,
        "count": 87,
        "temperature": 75.9,
        "accuracy": 80.5,
        "friendliness": 78.2,
        "cleanliness": 71.3,
        "problem": 6.9
      },
      "Columbia": {
        "overall": 78.9,
        "count": 19,
        "temperature": 78.9,
        "accuracy": 73.7,
        "friendliness": 68.4,
        "cleanliness": 63.2,
        "problem": 5.3
      },
      "Springfield": {
        "overall": 84.6,
        "count": 13,
        "temperature": 76.9,
        "accuracy": 84.6,
        "friendliness": 92.3,
        "cleanliness": 92.3,
        "problem": 7.7
      },
      "White House": {
        "overall": 92.9,
        "count": 14,
        "temperature": 85.7,
        "accuracy": 92.9,
        "friendliness": 92.9,
        "cleanliness": 78.6,
        "problem": 7.1
      },
      "Brentwood": {
        "overall": 45.5,
        "count": 11,
        "temperature": 45.5,
        "accuracy": 54.5,
        "friendliness": 54.5,
        "cleanliness": 45.5,
        "problem": 18.2
      },
      "Spring Hill": {
        "overall": 83.3,
        "count": 30,
        "temperature": 80,
        "accuracy": 86.7,
        "friendliness": 80,
        "cleanliness": 73.3,
        "problem": 3.3
      }
    }
  },
  {
    "label": "Week 13, 2026",
    "weekKey": "2026-W13",
    "stores": {
      "Combined": {
        "overall": 76.1,
        "count": 71,
        "temperature": 76.1,
        "accuracy": 81.7,
        "friendliness": 87.3,
        "cleanliness": 73.2,
        "problem": 5.6
      },
      "Columbia": {
        "overall": 68,
        "count": 25,
        "temperature": 80,
        "accuracy": 80,
        "friendliness": 92,
        "cleanliness": 76,
        "problem": 8
      },
      "Springfield": {
        "overall": 75,
        "count": 12,
        "temperature": 83.3,
        "accuracy": 83.3,
        "friendliness": 83.3,
        "cleanliness": 75,
        "problem": 0
      },
      "White House": {
        "overall": 69.2,
        "count": 13,
        "temperature": 46.2,
        "accuracy": 61.5,
        "friendliness": 61.5,
        "cleanliness": 53.8,
        "problem": 0
      },
      "Brentwood": {
        "overall": 100,
        "count": 4,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 100,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 88.2,
        "count": 17,
        "temperature": 82.4,
        "accuracy": 94.1,
        "friendliness": 100,
        "cleanliness": 76.5,
        "problem": 11.8
      }
    }
  },
  {
    "label": "Week 14, 2026",
    "weekKey": "2026-W14",
    "stores": {
      "Combined": {
        "overall": 84.5,
        "count": 84,
        "temperature": 81,
        "accuracy": 82.1,
        "friendliness": 83.3,
        "cleanliness": 73.8,
        "problem": 8.3
      },
      "Columbia": {
        "overall": 76.9,
        "count": 13,
        "temperature": 69.2,
        "accuracy": 76.9,
        "friendliness": 76.9,
        "cleanliness": 76.9,
        "problem": 15.4
      },
      "Springfield": {
        "overall": 82.4,
        "count": 17,
        "temperature": 82.4,
        "accuracy": 82.4,
        "friendliness": 82.4,
        "cleanliness": 70.6,
        "problem": 0
      },
      "White House": {
        "overall": 86.7,
        "count": 15,
        "temperature": 80,
        "accuracy": 93.3,
        "friendliness": 93.3,
        "cleanliness": 73.3,
        "problem": 6.7
      },
      "Brentwood": {
        "overall": 83.3,
        "count": 12,
        "temperature": 66.7,
        "accuracy": 75,
        "friendliness": 66.7,
        "cleanliness": 66.7,
        "problem": 16.7
      },
      "Spring Hill": {
        "overall": 88.9,
        "count": 27,
        "temperature": 92.6,
        "accuracy": 81.5,
        "friendliness": 88.9,
        "cleanliness": 77.8,
        "problem": 7.4
      }
    }
  },
  {
    "label": "Week 15, 2026",
    "weekKey": "2026-W15",
    "stores": {
      "Combined": {
        "overall": 78.3,
        "count": 83,
        "temperature": 78.3,
        "accuracy": 81.9,
        "friendliness": 73.5,
        "cleanliness": 74.7,
        "problem": 6
      },
      "Columbia": {
        "overall": 77.3,
        "count": 22,
        "temperature": 68.2,
        "accuracy": 81.8,
        "friendliness": 68.2,
        "cleanliness": 72.7,
        "problem": 0
      },
      "Springfield": {
        "overall": 81.3,
        "count": 16,
        "temperature": 93.8,
        "accuracy": 87.5,
        "friendliness": 81.3,
        "cleanliness": 75,
        "problem": 6.3
      },
      "White House": {
        "overall": 82.4,
        "count": 17,
        "temperature": 94.1,
        "accuracy": 88.2,
        "friendliness": 64.7,
        "cleanliness": 82.4,
        "problem": 5.9
      },
      "Brentwood": {
        "overall": 81.8,
        "count": 11,
        "temperature": 63.6,
        "accuracy": 72.7,
        "friendliness": 72.7,
        "cleanliness": 63.6,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 70.6,
        "count": 17,
        "temperature": 70.6,
        "accuracy": 76.5,
        "friendliness": 82.4,
        "cleanliness": 76.5,
        "problem": 17.6
      }
    }
  },
  {
    "label": "Week 16, 2026",
    "weekKey": "2026-W16",
    "stores": {
      "Combined": {
        "overall": 79.7,
        "count": 74,
        "temperature": 81.1,
        "accuracy": 79.7,
        "friendliness": 83.8,
        "cleanliness": 68.9,
        "problem": 5.4
      },
      "Columbia": {
        "overall": 65,
        "count": 20,
        "temperature": 80,
        "accuracy": 65,
        "friendliness": 75,
        "cleanliness": 60,
        "problem": 10
      },
      "Springfield": {
        "overall": 78.9,
        "count": 19,
        "temperature": 68.4,
        "accuracy": 78.9,
        "friendliness": 78.9,
        "cleanliness": 68.4,
        "problem": 5.3
      },
      "White House": {
        "overall": 91.7,
        "count": 12,
        "temperature": 91.7,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 83.3,
        "problem": 0
      },
      "Brentwood": {
        "overall": 85.7,
        "count": 7,
        "temperature": 100,
        "accuracy": 85.7,
        "friendliness": 100,
        "cleanliness": 71.4,
        "problem": 14.3
      },
      "Spring Hill": {
        "overall": 87.5,
        "count": 16,
        "temperature": 81.3,
        "accuracy": 81.3,
        "friendliness": 81.3,
        "cleanliness": 68.8,
        "problem": 0
      }
    }
  },
  {
    "label": "Week 17, 2026",
    "weekKey": "2026-W17",
    "stores": {
      "Combined": {
        "overall": 83.9,
        "count": 87,
        "temperature": 83.9,
        "accuracy": 89.7,
        "friendliness": 86.2,
        "cleanliness": 73.6,
        "problem": 3.4
      },
      "Columbia": {
        "overall": 88.9,
        "count": 18,
        "temperature": 88.9,
        "accuracy": 94.4,
        "friendliness": 88.9,
        "cleanliness": 77.8,
        "problem": 0
      },
      "Springfield": {
        "overall": 100,
        "count": 14,
        "temperature": 85.7,
        "accuracy": 92.9,
        "friendliness": 92.9,
        "cleanliness": 92.9,
        "problem": 0
      },
      "White House": {
        "overall": 80,
        "count": 15,
        "temperature": 86.7,
        "accuracy": 86.7,
        "friendliness": 80,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Brentwood": {
        "overall": 66.7,
        "count": 9,
        "temperature": 77.8,
        "accuracy": 88.9,
        "friendliness": 88.9,
        "cleanliness": 55.6,
        "problem": 11.1
      },
      "Spring Hill": {
        "overall": 80.6,
        "count": 31,
        "temperature": 80.6,
        "accuracy": 87.1,
        "friendliness": 83.9,
        "cleanliness": 71,
        "problem": 6.5
      }
    }
  },
  {
    "label": "Week 18, 2026",
    "weekKey": "2026-W18",
    "stores": {
      "Combined": {
        "overall": 81.9,
        "count": 72,
        "temperature": 80.6,
        "accuracy": 83.3,
        "friendliness": 83.3,
        "cleanliness": 83.3,
        "problem": 4.2
      },
      "Columbia": {
        "overall": 71.4,
        "count": 21,
        "temperature": 66.7,
        "accuracy": 76.2,
        "friendliness": 85.7,
        "cleanliness": 81,
        "problem": 4.8
      },
      "Springfield": {
        "overall": 100,
        "count": 9,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 88.9,
        "problem": 0
      },
      "White House": {
        "overall": 86.7,
        "count": 15,
        "temperature": 93.3,
        "accuracy": 93.3,
        "friendliness": 80,
        "cleanliness": 93.3,
        "problem": 0
      },
      "Brentwood": {
        "overall": 85.7,
        "count": 7,
        "temperature": 57.1,
        "accuracy": 71.4,
        "friendliness": 57.1,
        "cleanliness": 71.4,
        "problem": 14.3
      },
      "Spring Hill": {
        "overall": 80,
        "count": 20,
        "temperature": 85,
        "accuracy": 80,
        "friendliness": 85,
        "cleanliness": 80,
        "problem": 5
      }
    }
  },
  {
    "label": "Week 19, 2026",
    "weekKey": "2026-W19",
    "stores": {
      "Combined": {
        "overall": 81.9,
        "count": 72,
        "temperature": 75,
        "accuracy": 86.1,
        "friendliness": 81.9,
        "cleanliness": 70.8,
        "problem": 5.6
      },
      "Columbia": {
        "overall": 81.8,
        "count": 22,
        "temperature": 63.6,
        "accuracy": 77.3,
        "friendliness": 81.8,
        "cleanliness": 77.3,
        "problem": 0
      },
      "Springfield": {
        "overall": 92.3,
        "count": 13,
        "temperature": 92.3,
        "accuracy": 92.3,
        "friendliness": 92.3,
        "cleanliness": 76.9,
        "problem": 0
      },
      "White House": {
        "overall": 73.3,
        "count": 15,
        "temperature": 80,
        "accuracy": 86.7,
        "friendliness": 80,
        "cleanliness": 60,
        "problem": 6.7
      },
      "Brentwood": {
        "overall": 100,
        "count": 3,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 78.9,
        "count": 19,
        "temperature": 68.4,
        "accuracy": 89.5,
        "friendliness": 73.7,
        "cleanliness": 68.4,
        "problem": 15.8
      }
    }
  },
  {
    "label": "Week 20, 2026",
    "weekKey": "2026-W20",
    "stores": {
      "Combined": {
        "overall": 74.7,
        "count": 87,
        "temperature": 77,
        "accuracy": 80.5,
        "friendliness": 77,
        "cleanliness": 72.4,
        "problem": 14.9
      },
      "Columbia": {
        "overall": 67.9,
        "count": 28,
        "temperature": 71.4,
        "accuracy": 71.4,
        "friendliness": 75,
        "cleanliness": 67.9,
        "problem": 14.3
      },
      "Springfield": {
        "overall": 66.7,
        "count": 9,
        "temperature": 66.7,
        "accuracy": 66.7,
        "friendliness": 66.7,
        "cleanliness": 66.7,
        "problem": 22.2
      },
      "White House": {
        "overall": 83.3,
        "count": 12,
        "temperature": 75,
        "accuracy": 75,
        "friendliness": 75,
        "cleanliness": 66.7,
        "problem": 8.3
      },
      "Brentwood": {
        "overall": 66.7,
        "count": 9,
        "temperature": 66.7,
        "accuracy": 66.7,
        "friendliness": 55.6,
        "cleanliness": 44.4,
        "problem": 33.3
      },
      "Spring Hill": {
        "overall": 82.8,
        "count": 29,
        "temperature": 89.7,
        "accuracy": 100,
        "friendliness": 89.7,
        "cleanliness": 89.7,
        "problem": 10.3
      }
    }
  },
  {
    "label": "Week 21, 2026",
    "weekKey": "2026-W21",
    "stores": {
      "Combined": {
        "overall": 83.3,
        "count": 60,
        "temperature": 80,
        "accuracy": 88.3,
        "friendliness": 93.3,
        "cleanliness": 75,
        "problem": 6.7
      },
      "Columbia": {
        "overall": 93.8,
        "count": 16,
        "temperature": 93.8,
        "accuracy": 93.8,
        "friendliness": 93.8,
        "cleanliness": 68.8,
        "problem": 0
      },
      "Springfield": {
        "overall": 82.4,
        "count": 17,
        "temperature": 82.4,
        "accuracy": 82.4,
        "friendliness": 88.2,
        "cleanliness": 82.4,
        "problem": 5.9
      },
      "White House": {
        "overall": 87.5,
        "count": 8,
        "temperature": 75,
        "accuracy": 100,
        "friendliness": 100,
        "cleanliness": 75,
        "problem": 12.5
      },
      "Brentwood": {
        "overall": 85.7,
        "count": 7,
        "temperature": 85.7,
        "accuracy": 85.7,
        "friendliness": 85.7,
        "cleanliness": 71.4,
        "problem": 0
      },
      "Spring Hill": {
        "overall": 66.7,
        "count": 12,
        "temperature": 58.3,
        "accuracy": 83.3,
        "friendliness": 100,
        "cleanliness": 75,
        "problem": 16.7
      }
    }
  },
  {
    "label": "Week 22, 2026",
    "weekKey": "2026-W22",
    "stores": {
      "Combined": {
        "overall": 78.9,
        "count": 71,
        "temperature": 80.3,
        "accuracy": 83.1,
        "friendliness": 81.7,
        "cleanliness": 73.2,
        "problem": 5.6
      },
      "Columbia": {
        "overall": 90.9,
        "count": 22,
        "temperature": 81.8,
        "accuracy": 86.4,
        "friendliness": 77.3,
        "cleanliness": 86.4,
        "problem": 4.5
      },
      "Springfield": {
        "overall": 66.7,
        "count": 12,
        "temperature": 66.7,
        "accuracy": 66.7,
        "friendliness": 75,
        "cleanliness": 50,
        "problem": 0
      },
      "White House": {
        "overall": 76.9,
        "count": 13,
        "temperature": 92.3,
        "accuracy": 100,
        "friendliness": 92.3,
        "cleanliness": 76.9,
        "problem": 0
      },
      "Brentwood": {
        "overall": 50,
        "count": 6,
        "temperature": 50,
        "accuracy": 50,
        "friendliness": 66.7,
        "cleanliness": 16.7,
        "problem": 33.3
      },
      "Spring Hill": {
        "overall": 83.3,
        "count": 18,
        "temperature": 88.9,
        "accuracy": 88.9,
        "friendliness": 88.9,
        "cleanliness": 88.9,
        "problem": 5.6
      }
    }
  },
  {
    "label": "Week 23, 2026",
    "weekKey": "2026-W23",
    "stores": {
      "Combined": {
        "overall": 73.1,
        "count": 78,
        "temperature": 76.9,
        "accuracy": 82.1,
        "friendliness": 79.2,
        "cleanliness": 77.9,
        "problem": 7.7
      },
      "Columbia": {
        "overall": 90,
        "count": 20,
        "temperature": 95,
        "accuracy": 95,
        "friendliness": 80,
        "cleanliness": 85,
        "problem": 0
      },
      "Springfield": {
        "overall": 68,
        "count": 25,
        "temperature": 76,
        "accuracy": 80,
        "friendliness": 80,
        "cleanliness": 80,
        "problem": 8
      },
      "White House": {
        "overall": 80,
        "count": 10,
        "temperature": 60,
        "accuracy": 80,
        "friendliness": 60,
        "cleanliness": 70,
        "problem": 0
      },
      "Brentwood": {
        "overall": 50,
        "count": 10,
        "temperature": 60,
        "accuracy": 80,
        "friendliness": 88.9,
        "cleanliness": 66.7,
        "problem": 10
      },
      "Spring Hill": {
        "overall": 69.2,
        "count": 13,
        "temperature": 76.9,
        "accuracy": 69.2,
        "friendliness": 84.6,
        "cleanliness": 76.9,
        "problem": 23.1
      }
    }
  },
  {
    "label": "Week 24, 2026",
    "weekKey": "2026-W24",
    "stores": {
      "Combined": {
        "overall": 77.5,
        "count": 71,
        "temperature": 76.1,
        "accuracy": 85.9,
        "friendliness": 83.1,
        "cleanliness": 77.5,
        "problem": 14.1
      },
      "Columbia": {
        "overall": 76.5,
        "count": 17,
        "temperature": 76.5,
        "accuracy": 100,
        "friendliness": 94.1,
        "cleanliness": 76.5,
        "problem": 5.9
      },
      "Springfield": {
        "overall": 63.6,
        "count": 11,
        "temperature": 72.7,
        "accuracy": 63.6,
        "friendliness": 72.7,
        "cleanliness": 72.7,
        "problem": 18.2
      },
      "White House": {
        "overall": 100,
        "count": 11,
        "temperature": 100,
        "accuracy": 100,
        "friendliness": 81.8,
        "cleanliness": 90.9,
        "problem": 0
      },
      "Brentwood": {
        "overall": 70,
        "count": 10,
        "temperature": 50,
        "accuracy": 80,
        "friendliness": 80,
        "cleanliness": 80,
        "problem": 20
      },
      "Spring Hill": {
        "overall": 77.3,
        "count": 22,
        "temperature": 77.3,
        "accuracy": 81.8,
        "friendliness": 81.8,
        "cleanliness": 72.7,
        "problem": 22.7
      }
    }
  },
  {
    "label": "Week 25, 2026",
    "weekKey": "2026-W25",
    "stores": {
      "Combined": {
        "overall": 72.5,
        "count": 69,
        "temperature": 71,
        "accuracy": 72.5,
        "friendliness": 72.5,
        "cleanliness": 65.2,
        "problem": 11.6
      },
      "Columbia": {
        "overall": 87.5,
        "count": 16,
        "temperature": 81.3,
        "accuracy": 68.8,
        "friendliness": 81.3,
        "cleanliness": 68.8,
        "problem": 0
      },
      "Springfield": {
        "overall": 85.7,
        "count": 14,
        "temperature": 71.4,
        "accuracy": 85.7,
        "friendliness": 92.9,
        "cleanliness": 78.6,
        "problem": 0
      },
      "White House": {
        "overall": 61.1,
        "count": 18,
        "temperature": 61.1,
        "accuracy": 72.2,
        "friendliness": 61.1,
        "cleanliness": 55.6,
        "problem": 22.2
      },
      "Brentwood": {
        "overall": 55.6,
        "count": 9,
        "temperature": 55.6,
        "accuracy": 55.6,
        "friendliness": 55.6,
        "cleanliness": 44.4,
        "problem": 22.2
      },
      "Spring Hill": {
        "overall": 66.7,
        "count": 12,
        "temperature": 83.3,
        "accuracy": 75,
        "friendliness": 66.7,
        "cleanliness": 75,
        "problem": 16.7
      }
    }
  },
  {
    "label": "Week 26, 2026",
    "weekKey": "2026-W26",
    "stores": {
      "Combined": {
        "overall": 81.8,
        "count": 55,
        "temperature": 78.2,
        "accuracy": 87.3,
        "friendliness": 76.4,
        "cleanliness": 74.5,
        "problem": 5.5
      },
      "Columbia": {
        "overall": 83.3,
        "count": 12,
        "temperature": 66.7,
        "accuracy": 66.7,
        "friendliness": 50,
        "cleanliness": 66.7,
        "problem": 0
      },
      "Springfield": {
        "overall": 85.7,
        "count": 14,
        "temperature": 85.7,
        "accuracy": 100,
        "friendliness": 85.7,
        "cleanliness": 92.9,
        "problem": 0
      },
      "White House": {
        "overall": 85.7,
        "count": 14,
        "temperature": 92.9,
        "accuracy": 85.7,
        "friendliness": 92.9,
        "cleanliness": 78.6,
        "problem": 7.1
      },
      "Brentwood": {
        "overall": 0,
        "count": 1,
        "temperature": 0,
        "accuracy": 100,
        "friendliness": 0,
        "cleanliness": 0,
        "problem": 100
      },
      "Spring Hill": {
        "overall": 78.6,
        "count": 14,
        "temperature": 71.4,
        "accuracy": 92.9,
        "friendliness": 78.6,
        "cleanliness": 64.3,
        "problem": 7.1
      }
    }
  }
];
