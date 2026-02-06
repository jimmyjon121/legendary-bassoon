/**
 * Contextual Learning Service
 * 
 * Detects patterns in code and offers contextual learning opportunities
 * to help developers learn modern patterns and best practices.
 */

// Learning opportunities keyed by pattern
const LEARNING_OPPORTUNITIES = [
  // React patterns
  {
    id: 'react-query',
    pattern: /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*fetch/s,
    title: 'Modern Data Fetching',
    summary: 'Consider using React Query or SWR for data fetching',
    level: 'intermediate',
    category: 'react',
    lesson: {
      current: 'Using useEffect for data fetching',
      better: 'React Query / SWR handles caching, deduplication, and background refresh automatically',
      benefits: [
        'Automatic caching and deduplication',
        'Background data refresh',
        'Built-in loading and error states',
        'Automatic retries'
      ],
      example: `// Instead of:
useEffect(() => {
  fetch('/api/users').then(r => r.json()).then(setUsers);
}, []);

// Use React Query:
const { data: users, isLoading } = useQuery({
  queryKey: ['users'],
  queryFn: () => fetch('/api/users').then(r => r.json())
});`,
      resources: [
        { title: 'React Query Docs', url: 'https://tanstack.com/query/latest' },
        { title: 'SWR Documentation', url: 'https://swr.vercel.app/' }
      ]
    }
  },
  {
    id: 'async-await',
    pattern: /\.then\s*\([^)]*\)\s*\.then/s,
    title: 'Async/Await Pattern',
    summary: 'Nested .then() chains can be simplified with async/await',
    level: 'beginner',
    category: 'javascript',
    lesson: {
      current: 'Promise chaining with .then()',
      better: 'async/await provides cleaner, more readable async code',
      benefits: [
        'More readable sequential async code',
        'Easier error handling with try/catch',
        'Better debugging with proper stack traces',
        'Simpler conditionals in async code'
      ],
      example: `// Instead of:
fetchUser(id)
  .then(user => fetchOrders(user.id))
  .then(orders => processOrders(orders))
  .catch(handleError);

// Use async/await:
async function getUserOrders(id) {
  try {
    const user = await fetchUser(id);
    const orders = await fetchOrders(user.id);
    return processOrders(orders);
  } catch (error) {
    handleError(error);
  }
}`,
      resources: [
        { title: 'MDN async/await', url: 'https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Asynchronous/Promises' }
      ]
    }
  },
  {
    id: 'const-let',
    pattern: /\bvar\s+\w+\s*=/,
    title: 'Modern Variable Declarations',
    summary: 'Use const and let instead of var',
    level: 'beginner',
    category: 'javascript',
    lesson: {
      current: 'Using var for variable declarations',
      better: 'const and let provide block scoping and prevent common bugs',
      benefits: [
        'Block scoping prevents variable hoisting issues',
        'const prevents accidental reassignment',
        'Easier to reason about code',
        'Better IDE support and error catching'
      ],
      example: `// Instead of:
var count = 0;
var name = 'John';

// Use:
const name = 'John';  // Won't be reassigned
let count = 0;        // Will be reassigned`,
      resources: [
        { title: 'let vs var vs const', url: 'https://www.freecodecamp.org/news/var-let-and-const-whats-the-difference/' }
      ]
    }
  },
  {
    id: 'optional-chaining',
    pattern: /(\w+)\s*&&\s*\1\.\w+\s*&&\s*\1\.\w+\.\w+/,
    title: 'Optional Chaining',
    summary: 'Simplify nested property access with ?.',
    level: 'beginner',
    category: 'javascript',
    lesson: {
      current: 'Multiple && checks for nested properties',
      better: 'Optional chaining (?.) provides cleaner null checks',
      benefits: [
        'Cleaner, more readable code',
        'Less prone to errors',
        'Works with methods and arrays too'
      ],
      example: `// Instead of:
const city = user && user.address && user.address.city;

// Use optional chaining:
const city = user?.address?.city;

// Also works with methods:
user?.getFullName?.();

// And arrays:
users?.[0]?.name;`,
      resources: [
        { title: 'Optional Chaining', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining' }
      ]
    }
  },
  {
    id: 'nullish-coalescing',
    pattern: /(\w+)\s*===?\s*(null|undefined)\s*\?\s*.+\s*:\s*\1/,
    title: 'Nullish Coalescing',
    summary: 'Use ?? for cleaner default values',
    level: 'beginner',
    category: 'javascript',
    lesson: {
      current: 'Ternary or || for default values',
      better: '?? operator only falls back for null/undefined',
      benefits: [
        'Preserves falsy values like 0, empty string, false',
        'More precise default handling',
        'Clearer intent'
      ],
      example: `// Problem with ||:
const count = input || 10;  // If input is 0, returns 10!

// Better with ??:
const count = input ?? 10;  // Only if input is null/undefined`,
      resources: [
        { title: 'Nullish Coalescing', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing' }
      ]
    }
  },
  {
    id: 'destructuring',
    pattern: /const\s+\w+\s*=\s*props\.\w+;\s*const\s+\w+\s*=\s*props\.\w+/,
    title: 'Object Destructuring',
    summary: 'Extract multiple properties in one line',
    level: 'beginner',
    category: 'javascript',
    lesson: {
      current: 'Extracting properties one by one',
      better: 'Destructuring extracts multiple properties elegantly',
      benefits: [
        'Cleaner, more concise code',
        'Easy to rename properties',
        'Works with nested objects too'
      ],
      example: `// Instead of:
const name = props.name;
const age = props.age;
const email = props.email;

// Use destructuring:
const { name, age, email } = props;

// With renaming:
const { name: userName, age: userAge } = props;

// With defaults:
const { name = 'Anonymous' } = props;`,
      resources: [
        { title: 'Destructuring Assignment', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment' }
      ]
    }
  },
  {
    id: 'template-literals',
    pattern: /['"][^'"]*['"]\s*\+\s*\w+\s*\+\s*['"][^'"]*['"]/,
    title: 'Template Literals',
    summary: 'Use template literals for string interpolation',
    level: 'beginner',
    category: 'javascript',
    lesson: {
      current: 'String concatenation with +',
      better: 'Template literals are cleaner and support multiline',
      benefits: [
        'Cleaner interpolation syntax',
        'Easy multiline strings',
        'Supports expressions inside ${}',
        'Tagged templates for advanced use'
      ],
      example: `// Instead of:
const message = 'Hello, ' + name + '! You have ' + count + ' messages.';

// Use template literals:
const message = \`Hello, \${name}! You have \${count} messages.\`;

// Multiline:
const html = \`
  <div>
    <h1>\${title}</h1>
    <p>\${description}</p>
  </div>
\`;`,
      resources: [
        { title: 'Template Literals', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals' }
      ]
    }
  },
  {
    id: 'array-methods',
    pattern: /for\s*\(\s*(let|var)\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*\w+\.length/,
    title: 'Modern Array Methods',
    summary: 'Use map, filter, reduce instead of for loops',
    level: 'intermediate',
    category: 'javascript',
    lesson: {
      current: 'Traditional for loops for array operations',
      better: 'Array methods are more declarative and functional',
      benefits: [
        'More readable and declarative',
        'No off-by-one errors',
        'Chainable operations',
        'Immutable by default'
      ],
      example: `// Instead of:
const doubled = [];
for (let i = 0; i < numbers.length; i++) {
  doubled.push(numbers[i] * 2);
}

// Use map:
const doubled = numbers.map(n => n * 2);

// Chaining:
const result = numbers
  .filter(n => n > 0)
  .map(n => n * 2)
  .reduce((sum, n) => sum + n, 0);`,
      resources: [
        { title: 'Array Methods', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array' }
      ]
    }
  },
  {
    id: 'spread-operator',
    pattern: /Object\.assign\s*\(\s*\{\s*\}\s*,/,
    title: 'Spread Operator',
    summary: 'Use spread syntax for object/array operations',
    level: 'beginner',
    category: 'javascript',
    lesson: {
      current: 'Using Object.assign for object copying',
      better: 'Spread operator is cleaner and works with arrays too',
      benefits: [
        'Cleaner syntax',
        'Works with both objects and arrays',
        'Easy to combine/merge',
        'Immutable patterns'
      ],
      example: `// Instead of:
const newObj = Object.assign({}, oldObj, { newProp: 'value' });

// Use spread:
const newObj = { ...oldObj, newProp: 'value' };

// Arrays:
const newArray = [...oldArray, newItem];

// Function arguments:
Math.max(...numbers);`,
      resources: [
        { title: 'Spread Syntax', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Spread_syntax' }
      ]
    }
  },
  {
    id: 'use-memo',
    pattern: /useMemo\s*\(\s*\(\s*\)\s*=>\s*\w+\s*,\s*\[\s*\]\s*\)/,
    title: 'Proper useMemo Usage',
    summary: 'useMemo with empty deps may indicate misuse',
    level: 'intermediate',
    category: 'react',
    lesson: {
      current: 'useMemo with empty dependency array',
      better: 'Empty deps means the value never updates - consider if you need useMemo at all',
      benefits: [
        'Avoid unnecessary complexity',
        'Don\'t optimize prematurely',
        'Use useMemo for expensive calculations with dependencies'
      ],
      example: `// Potentially unnecessary:
const value = useMemo(() => expensiveCalc(), []);

// If deps are empty, consider:
// 1. Moving outside component if truly constant
// 2. Using useRef if you need the instance
// 3. Just declaring it directly if not expensive

// Proper use:
const filtered = useMemo(
  () => items.filter(i => i.active),
  [items]  // Recalculates when items change
);`,
      resources: [
        { title: 'useMemo Guide', url: 'https://react.dev/reference/react/useMemo' }
      ]
    }
  }
];

// Skill categories
const SKILL_CATEGORIES = {
  javascript: {
    name: 'JavaScript',
    icon: '🟨',
    levels: ['beginner', 'intermediate', 'advanced']
  },
  react: {
    name: 'React',
    icon: '⚛️',
    levels: ['beginner', 'intermediate', 'advanced']
  },
  typescript: {
    name: 'TypeScript',
    icon: '🔷',
    levels: ['beginner', 'intermediate', 'advanced']
  },
  testing: {
    name: 'Testing',
    icon: '🧪',
    levels: ['beginner', 'intermediate', 'advanced']
  },
  patterns: {
    name: 'Design Patterns',
    icon: '🏗️',
    levels: ['intermediate', 'advanced']
  }
};

class ContextualLearning {
  constructor() {
    this.opportunities = LEARNING_OPPORTUNITIES;
    this.skillProgress = new Map(); // category -> { level, completed: Set }
    this.detectedPatterns = [];
    this.dismissedLessons = new Set();
    this.completedLessons = new Set();
    this.listeners = new Set();
    
    // Initialize skill progress
    Object.keys(SKILL_CATEGORIES).forEach(category => {
      this.skillProgress.set(category, {
        level: 'beginner',
        completed: new Set(),
        points: 0
      });
    });
  }

  /**
   * Analyze code for learning opportunities
   */
  analyzeCode(code, filePath = '') {
    if (!code || code.length < 10) return [];

    const detected = [];
    
    for (const opportunity of this.opportunities) {
      // Skip dismissed or completed lessons
      if (this.dismissedLessons.has(opportunity.id) || 
          this.completedLessons.has(opportunity.id)) {
        continue;
      }

      // Test pattern
      if (opportunity.pattern.test(code)) {
        detected.push({
          ...opportunity,
          detectedAt: Date.now(),
          filePath,
          matchLocation: this.findMatchLocation(code, opportunity.pattern)
        });
      }
    }

    this.detectedPatterns = detected;
    
    if (detected.length > 0) {
      this.notifyListeners();
    }

    return detected;
  }

  /**
   * Find the line number where pattern matched
   */
  findMatchLocation(code, pattern) {
    const match = code.match(pattern);
    if (!match) return null;

    const beforeMatch = code.substring(0, match.index);
    const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;
    
    return {
      line: lineNumber,
      snippet: match[0].substring(0, 100)
    };
  }

  /**
   * Get current detected opportunities
   */
  getDetectedOpportunities() {
    return this.detectedPatterns.filter(
      p => !this.dismissedLessons.has(p.id) && !this.completedLessons.has(p.id)
    );
  }

  /**
   * Get a specific lesson by ID
   */
  getLesson(lessonId) {
    return this.opportunities.find(o => o.id === lessonId);
  }

  /**
   * Mark a lesson as completed
   */
  completeLesson(lessonId) {
    const lesson = this.getLesson(lessonId);
    if (!lesson) return false;

    this.completedLessons.add(lessonId);
    
    // Update skill progress
    const progress = this.skillProgress.get(lesson.category);
    if (progress) {
      progress.completed.add(lessonId);
      progress.points += this.getLevelPoints(lesson.level);
      
      // Check for level up
      if (progress.points >= this.getPointsForNextLevel(progress.level)) {
        progress.level = this.getNextLevel(progress.level);
      }
    }

    this.notifyListeners();
    return true;
  }

  /**
   * Dismiss a lesson (won't show again)
   */
  dismissLesson(lessonId) {
    this.dismissedLessons.add(lessonId);
    this.notifyListeners();
  }

  /**
   * Get points for completing a lesson of a given level
   */
  getLevelPoints(level) {
    switch (level) {
      case 'beginner': return 10;
      case 'intermediate': return 25;
      case 'advanced': return 50;
      default: return 10;
    }
  }

  /**
   * Get points needed for next level
   */
  getPointsForNextLevel(currentLevel) {
    switch (currentLevel) {
      case 'beginner': return 100;
      case 'intermediate': return 250;
      case 'advanced': return Infinity;
      default: return 100;
    }
  }

  /**
   * Get the next level
   */
  getNextLevel(currentLevel) {
    switch (currentLevel) {
      case 'beginner': return 'intermediate';
      case 'intermediate': return 'advanced';
      default: return 'advanced';
    }
  }

  /**
   * Get skill progress for all categories
   */
  getSkillProgress() {
    const progress = {};
    
    for (const [category, data] of this.skillProgress) {
      const categoryInfo = SKILL_CATEGORIES[category];
      const maxPoints = category === 'patterns' ? 500 : 350;
      
      progress[category] = {
        ...categoryInfo,
        level: data.level,
        points: data.points,
        maxPoints,
        percentage: Math.min(100, Math.round((data.points / maxPoints) * 100)),
        completedLessons: data.completed.size,
        totalLessons: this.opportunities.filter(o => o.category === category).length
      };
    }
    
    return progress;
  }

  /**
   * Get overall learning statistics
   */
  getStatistics() {
    const total = this.opportunities.length;
    const completed = this.completedLessons.size;
    const dismissed = this.dismissedLessons.size;
    const available = total - completed - dismissed;

    return {
      total,
      completed,
      dismissed,
      available,
      completionRate: Math.round((completed / total) * 100),
      skillProgress: this.getSkillProgress()
    };
  }

  /**
   * Reset all progress (for testing)
   */
  reset() {
    this.completedLessons.clear();
    this.dismissedLessons.clear();
    this.detectedPatterns = [];
    
    Object.keys(SKILL_CATEGORIES).forEach(category => {
      this.skillProgress.set(category, {
        level: 'beginner',
        completed: new Set(),
        points: 0
      });
    });

    this.notifyListeners();
  }

  /**
   * Add a state change listener
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners
   */
  notifyListeners() {
    const data = {
      opportunities: this.getDetectedOpportunities(),
      statistics: this.getStatistics()
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('Contextual learning listener error:', error);
      }
    });
  }
}

// Singleton instance
let instance = null;

export function getContextualLearning() {
  if (!instance) {
    instance = new ContextualLearning();
  }
  return instance;
}

export function createContextualLearning() {
  return new ContextualLearning();
}

export { LEARNING_OPPORTUNITIES, SKILL_CATEGORIES };
export default ContextualLearning;
