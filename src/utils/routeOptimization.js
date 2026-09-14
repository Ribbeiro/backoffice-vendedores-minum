// Directed road distances: a one-way street can have different outward/return costs.
export function routeCost(order, distances) {
  return order.slice(1).reduce((total, stop, index) => total + distances[order[index]][stop], 0);
}

export function optimizeRoadOrder(matrix, { keepLast = false } = {}) {
  const n = matrix.length;
  if (n < 2 || n > 24 || matrix.some(row => !Array.isArray(row) || row.length !== n)) {
    throw new Error('A matriz de distancias da rota esta incompleta.');
  }
  const distances = matrix.map((row, i) => row.map((value, j) => {
    if (i === j) return 0;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : Infinity;
  }));
  const original = Array.from({ length: n }, (_, i) => i);
  const movable = original.slice(1, keepLast ? -1 : undefined);
  const seeds = [original];
  // Try each initial branch, avoiding the common nearest-neighbour dead end.
  for (const first of movable) {
    const order = [0, first];
    const remaining = movable.filter(i => i !== first);
    while (remaining.length) {
      remaining.sort((a, b) => distances[order.at(-1)][a] - distances[order.at(-1)][b] || a - b);
      order.push(remaining.shift());
    }
    if (keepLast) order.push(n - 1);
    seeds.push(order);
  }
  let best = original;
  let bestCost = routeCost(best, distances);
  for (let order of seeds) {
    let cost = routeCost(order, distances);
    const end = keepLast ? n - 1 : n;
    // Full directed cost is evaluated, including edges inside reversed segments.
    for (let pass = 0; pass < n * 2; pass++) {
      let next = order;
      let nextCost = cost;
      const consider = candidate => {
        const value = routeCost(candidate, distances);
        if (value < nextCost - 0.001) { next = candidate; nextCost = value; }
      };
      for (let i = 1; i < end; i++) {
        for (let j = i + 1; j < end; j++) {
          consider([...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)]);
        }
        for (let j = 1; j < end; j++) {
          if (i === j) continue;
          const moved = [...order];
          const [stop] = moved.splice(i, 1);
          moved.splice(j, 0, stop);
          consider(moved);
        }
      }
      if (next === order) break;
      order = next;
      cost = nextCost;
    }
    if (cost < bestCost) { best = order; bestCost = cost; }
  }
  if (!Number.isFinite(bestCost)) throw new Error('Nao foi encontrado um percurso por ruas ligando todas as paradas. Revise as localizacoes.');
  return best;
}
