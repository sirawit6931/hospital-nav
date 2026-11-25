package services

import (
	"container/heap"
	"math"

	"hospital-nav-backend/models"
)

type neighbor struct {
	nodeID uint
	weight float64
}

type pqItem struct {
	nodeID uint
	dist   float64
}

type priorityQueue []pqItem

func (pq priorityQueue) Len() int           { return len(pq) }
func (pq priorityQueue) Less(i, j int) bool { return pq[i].dist < pq[j].dist }
func (pq priorityQueue) Swap(i, j int)      { pq[i], pq[j] = pq[j], pq[i] }

func (pq *priorityQueue) Push(x any) {
	*pq = append(*pq, x.(pqItem))
}

func (pq *priorityQueue) Pop() any {
	old := *pq
	n := len(old)
	item := old[n-1]
	*pq = old[:n-1]
	return item
}

// FindShortestPath runs Dijkstra's algorithm on an undirected graph built from active map_edges.
// Returns the ordered sequence of node IDs from startID to targetID, total distance in meters,
// and a boolean indicating whether a valid path was found.
func FindShortestPath(edges []models.MapEdge, startID, targetID uint) ([]uint, float64, bool) {
	if startID == targetID {
		return []uint{startID}, 0, true
	}

	// Build an undirected adjacency list from active edges only.
	adj := make(map[uint][]neighbor)
	for _, e := range edges {
		if !e.IsActive {
			continue
		}
		weight := e.DistanceM
		if math.IsNaN(weight) || math.IsInf(weight, 0) || weight < 0 {
			continue
		}
		adj[e.FromNode] = append(adj[e.FromNode], neighbor{nodeID: e.ToNode, weight: weight})
		adj[e.ToNode] = append(adj[e.ToNode], neighbor{nodeID: e.FromNode, weight: weight})
	}

	if len(adj[startID]) == 0 || len(adj[targetID]) == 0 {
		return nil, 0, false
	}

	dist := map[uint]float64{startID: 0}
	prev := make(map[uint]uint)

	pq := &priorityQueue{{nodeID: startID, dist: 0}}
	heap.Init(pq)

	for pq.Len() > 0 {
		current := heap.Pop(pq).(pqItem)

		// Skip outdated queue entries.
		if best, ok := dist[current.nodeID]; ok && current.dist > best {
			continue
		}

		if current.nodeID == targetID {
			break
		}

		for _, nb := range adj[current.nodeID] {
			candidateDist := current.dist + nb.weight
			if prevBest, exists := dist[nb.nodeID]; !exists || candidateDist < prevBest {
				dist[nb.nodeID] = candidateDist
				prev[nb.nodeID] = current.nodeID
				heap.Push(pq, pqItem{nodeID: nb.nodeID, dist: candidateDist})
			}
		}
	}

	totalDist, reached := dist[targetID]
	if !reached {
		return nil, 0, false
	}

	// Reconstruct path from targetID back to startID safely.
	var reversed []uint
	seen := make(map[uint]bool)
	curr := targetID
	for {
		if seen[curr] {
			return nil, 0, false
		}
		seen[curr] = true
		reversed = append(reversed, curr)
		if curr == startID {
			break
		}
		parent, ok := prev[curr]
		if !ok {
			return nil, 0, false
		}
		curr = parent
	}

	// Reverse slice so it goes from startID -> targetID.
	for i, j := 0, len(reversed)-1; i < j; i, j = i+1, j-1 {
		reversed[i], reversed[j] = reversed[j], reversed[i]
	}

	return reversed, totalDist, true
}
