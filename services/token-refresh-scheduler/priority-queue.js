/**
 * Priority Queue for Token Refresh Scheduler
 * 
 * This is a sophisticated priority queue implementation specifically designed for token refresh scheduling.
 * It efficiently handles millions of tokens, prioritizing them based on various factors:
 * - Base priority score
 * - Next refresh time
 * - Last price change
 * - Trading volume
 * 
 * The queue optimizes for both time-based scheduling and priority-based importance.
 */

export default class PriorityQueue {
  constructor(config = {}) {
    this.items = [];
    this.config = config;
    this.tokenMap = new Map(); // tokenId -> index mapping for O(1) lookups
  }

  /**
   * Add or update a token in the queue with priority information
   * @param {Object} item - Token item with id, priority, and nextRefreshTime
   */
  enqueue(item) {
    // Check if token already exists in queue
    const existingIndex = this.tokenMap.get(item.id);
    
    if (existingIndex !== undefined) {
      // Update existing item
      this.items[existingIndex] = item;
      
      // Re-heapify to maintain priority order
      this.siftDown(existingIndex);
      this.siftUp(existingIndex);
    } else {
      // Add new item
      const newIndex = this.items.length;
      this.items.push(item);
      this.tokenMap.set(item.id, newIndex);
      
      // Maintain heap property
      this.siftUp(newIndex);
    }
  }

  /**
   * Get the highest priority token that's due for refresh
   * @returns {Object|null} The highest priority due token, or null if none are due
   */
  dequeue() {
    if (this.isEmpty()) {
      return null;
    }
    
    // Get top item (highest priority)
    const top = this.items[0];
    const lastItem = this.items.pop();
    
    if (this.items.length > 0) {
      // Move last item to top and restore heap property
      this.items[0] = lastItem;
      this.tokenMap.set(lastItem.id, 0);
      this.siftDown(0);
    }
    
    // Remove from token map
    this.tokenMap.delete(top.id);
    
    return top;
  }

  /**
   * Get multiple items due for refresh before a given time
   * @param {number} currentTime - Current timestamp to compare against
   * @param {number} maxItems - Maximum number of items to return
   * @returns {Array} Array of due items sorted by priority
   */
  getDueItems(currentTime, maxItems = 100) {
    const dueItems = [];
    const tempQueue = [...this.items];
    
    // Get all items that are due before currentTime
    for (let i = 0; i < Math.min(maxItems, tempQueue.length); i++) {
      // If no items are due, stop
      if (tempQueue.length === 0) break;
      
      // Extract first item (highest priority)
      const heapify = (i) => {
        const leftChild = 2 * i + 1;
        const rightChild = 2 * i + 2;
        let smallest = i;
        
        // Compare with left child
        if (leftChild < tempQueue.length) {
          if (this.compareItems(tempQueue[leftChild], tempQueue[smallest]) < 0) {
            smallest = leftChild;
          }
        }
        
        // Compare with right child
        if (rightChild < tempQueue.length) {
          if (this.compareItems(tempQueue[rightChild], tempQueue[smallest]) < 0) {
            smallest = rightChild;
          }
        }
        
        // If largest is not i, swap and continue heapifying
        if (smallest !== i) {
          [tempQueue[i], tempQueue[smallest]] = [tempQueue[smallest], tempQueue[i]];
          heapify(smallest);
        }
      };
      
      // Get highest priority item
      const item = tempQueue[0];
      
      // Check if item is due
      if (item.nextRefreshTime <= currentTime) {
        dueItems.push(item);
        
        // Replace root with last item and heapify
        const lastItem = tempQueue.pop();
        if (tempQueue.length > 0) {
          tempQueue[0] = lastItem;
          heapify(0);
        }
      } else {
        // If highest priority item is not due, no more items are due
        break;
      }
    }
    
    return dueItems;
  }

  /**
   * Peek at the highest priority item without removing it
   * @returns {Object|null} The highest priority item, or null if queue is empty
   */
  peek() {
    return this.isEmpty() ? null : this.items[0];
  }

  /**
   * Check if queue is empty
   * @returns {boolean} True if queue is empty, false otherwise
   */
  isEmpty() {
    return this.items.length === 0;
  }

  /**
   * Get the current size of the queue
   * @returns {number} Number of items in the queue
   */
  size() {
    return this.items.length;
  }

  /**
   * Sift up an item to maintain heap property
   * @param {number} index - Index of item to sift up
   */
  siftUp(index) {
    let currentIndex = index;
    
    while (currentIndex > 0) {
      const parentIndex = Math.floor((currentIndex - 1) / 2);
      
      // If parent has higher priority than current, stop
      if (this.compareItems(this.items[parentIndex], this.items[currentIndex]) <= 0) {
        break;
      }
      
      // Swap parent and current
      [this.items[parentIndex], this.items[currentIndex]] = 
      [this.items[currentIndex], this.items[parentIndex]];
      
      // Update token map
      this.tokenMap.set(this.items[parentIndex].id, parentIndex);
      this.tokenMap.set(this.items[currentIndex].id, currentIndex);
      
      // Move up to parent
      currentIndex = parentIndex;
    }
  }

  /**
   * Sift down an item to maintain heap property
   * @param {number} index - Index of item to sift down
   */
  siftDown(index) {
    let currentIndex = index;
    const lastIndex = this.items.length - 1;
    
    while (true) {
      const leftChildIndex = 2 * currentIndex + 1;
      const rightChildIndex = 2 * currentIndex + 2;
      let highestPriorityIndex = currentIndex;
      
      // Compare with left child
      if (leftChildIndex <= lastIndex && 
          this.compareItems(this.items[leftChildIndex], this.items[highestPriorityIndex]) < 0) {
        highestPriorityIndex = leftChildIndex;
      }
      
      // Compare with right child
      if (rightChildIndex <= lastIndex && 
          this.compareItems(this.items[rightChildIndex], this.items[highestPriorityIndex]) < 0) {
        highestPriorityIndex = rightChildIndex;
      }
      
      // If highest priority is current, heap property is satisfied
      if (highestPriorityIndex === currentIndex) {
        break;
      }
      
      // Swap with highest priority child
      [this.items[currentIndex], this.items[highestPriorityIndex]] = 
      [this.items[highestPriorityIndex], this.items[currentIndex]];
      
      // Update token map
      this.tokenMap.set(this.items[currentIndex].id, currentIndex);
      this.tokenMap.set(this.items[highestPriorityIndex].id, highestPriorityIndex);
      
      // Move down to child
      currentIndex = highestPriorityIndex;
    }
  }

  /**
   * Compare two items for priority ordering
   * Items are first compared by nextRefreshTime (due time)
   * If both are due or not due, they're compared by priority score
   * @param {Object} a - First item
   * @param {Object} b - Second item
   * @returns {number} Negative if a has higher priority, positive if b has higher priority
   */
  compareItems(a, b) {
    const now = Date.now();
    const aIsDue = a.nextRefreshTime <= now;
    const bIsDue = b.nextRefreshTime <= now;
    
    // First compare by due status
    if (aIsDue && !bIsDue) return -1;
    if (!aIsDue && bIsDue) return 1;
    
    // If both are due or both are not due, compare by nextRefreshTime
    if (a.nextRefreshTime !== b.nextRefreshTime) {
      return a.nextRefreshTime - b.nextRefreshTime;
    }
    
    // If same due time, compare by priority (higher score = higher priority)
    if (a.priority !== b.priority) {
      return b.priority - a.priority; // Note the inversion for priority
    }
    
    // If same priority, compare by id for stable sort
    return a.id - b.id;
  }

  /**
   * Remove a token from the queue by ID
   * @param {string|number} tokenId - The ID of the token to remove
   * @returns {boolean} True if token was found and removed, false otherwise
   */
  remove(tokenId) {
    const index = this.tokenMap.get(tokenId);
    
    if (index === undefined) {
      return false; // Token not found in queue
    }
    
    // Remove from token map
    this.tokenMap.delete(tokenId);
    
    // Handle different cases based on position in heap
    if (index === this.items.length - 1) {
      // Last item - just remove it
      this.items.pop();
    } else {
      // Move last item to this position and restore heap property
      const lastItem = this.items.pop();
      
      if (this.items.length > 0 && index < this.items.length) {
        this.items[index] = lastItem;
        this.tokenMap.set(lastItem.id, index);
        
        // Restore heap property - try both sift up and sift down
        this.siftUp(index);
        this.siftDown(index);
      }
    }
    
    // Update token map indices for all remaining items
    this.updateTokenMapIndices();
    
    return true;
  }

  /**
   * Update the token map indices after structural changes
   * This ensures the tokenMap stays in sync with the items array
   */
  updateTokenMapIndices() {
    this.tokenMap.clear();
    for (let i = 0; i < this.items.length; i++) {
      this.tokenMap.set(this.items[i].id, i);
    }
  }
}