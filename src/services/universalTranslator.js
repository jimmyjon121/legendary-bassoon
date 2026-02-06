/**
 * Universal Code Translator Service
 * 
 * Translates code patterns and logic across programming languages,
 * preserving intent and providing idiomatic conversions.
 */

// Supported languages
const LANGUAGES = {
  javascript: {
    id: 'javascript',
    name: 'JavaScript',
    icon: '🟨',
    extension: '.js',
    aliases: ['js', 'node', 'nodejs']
  },
  typescript: {
    id: 'typescript',
    name: 'TypeScript',
    icon: '🔷',
    extension: '.ts',
    aliases: ['ts']
  },
  python: {
    id: 'python',
    name: 'Python',
    icon: '🐍',
    extension: '.py',
    aliases: ['py', 'python3']
  },
  rust: {
    id: 'rust',
    name: 'Rust',
    icon: '🦀',
    extension: '.rs',
    aliases: ['rs']
  },
  go: {
    id: 'go',
    name: 'Go',
    icon: '🐹',
    extension: '.go',
    aliases: ['golang']
  },
  java: {
    id: 'java',
    name: 'Java',
    icon: '☕',
    extension: '.java',
    aliases: []
  },
  csharp: {
    id: 'csharp',
    name: 'C#',
    icon: '💜',
    extension: '.cs',
    aliases: ['cs', 'dotnet']
  },
  ruby: {
    id: 'ruby',
    name: 'Ruby',
    icon: '💎',
    extension: '.rb',
    aliases: ['rb']
  },
  php: {
    id: 'php',
    name: 'PHP',
    icon: '🐘',
    extension: '.php',
    aliases: []
  },
  swift: {
    id: 'swift',
    name: 'Swift',
    icon: '🍎',
    extension: '.swift',
    aliases: []
  },
  kotlin: {
    id: 'kotlin',
    name: 'Kotlin',
    icon: '🟣',
    extension: '.kt',
    aliases: ['kt']
  }
};

// Pattern equivalents across languages
const PATTERN_MAPPINGS = {
  async_await: {
    javascript: {
      pattern: 'async function name() { await ... }',
      example: `async function fetchData() {
  const response = await fetch(url);
  return await response.json();
}`
    },
    python: {
      pattern: 'async def name(): await ...',
      example: `async def fetch_data():
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.json()`
    },
    rust: {
      pattern: 'async fn name() -> Result<T, E> { .await }',
      example: `async fn fetch_data() -> Result<Data, Error> {
    let response = reqwest::get(url).await?;
    let data = response.json().await?;
    Ok(data)
}`
    },
    go: {
      pattern: 'goroutines and channels',
      example: `func fetchData() (*Data, error) {
    ch := make(chan *Data)
    go func() {
        resp, _ := http.Get(url)
        // process...
        ch <- data
    }()
    return <-ch, nil
}`
    }
  },
  
  array_map: {
    javascript: {
      pattern: 'array.map(item => transform)',
      example: `const doubled = numbers.map(n => n * 2);`
    },
    python: {
      pattern: '[transform for item in array]',
      example: `doubled = [n * 2 for n in numbers]`
    },
    rust: {
      pattern: 'iter().map(|item| transform).collect()',
      example: `let doubled: Vec<i32> = numbers.iter().map(|n| n * 2).collect();`
    },
    go: {
      pattern: 'for loop with append',
      example: `doubled := make([]int, len(numbers))
for i, n := range numbers {
    doubled[i] = n * 2
}`
    },
    java: {
      pattern: 'stream().map().collect()',
      example: `List<Integer> doubled = numbers.stream()
    .map(n -> n * 2)
    .collect(Collectors.toList());`
    }
  },

  array_filter: {
    javascript: {
      pattern: 'array.filter(item => condition)',
      example: `const evens = numbers.filter(n => n % 2 === 0);`
    },
    python: {
      pattern: '[item for item in array if condition]',
      example: `evens = [n for n in numbers if n % 2 == 0]`
    },
    rust: {
      pattern: 'iter().filter(|item| condition).collect()',
      example: `let evens: Vec<i32> = numbers.iter().filter(|n| *n % 2 == 0).copied().collect();`
    },
    java: {
      pattern: 'stream().filter().collect()',
      example: `List<Integer> evens = numbers.stream()
    .filter(n -> n % 2 == 0)
    .collect(Collectors.toList());`
    }
  },

  null_check: {
    javascript: {
      pattern: 'value?.property ?? default',
      example: `const name = user?.profile?.name ?? 'Anonymous';`
    },
    typescript: {
      pattern: 'value?.property ?? default',
      example: `const name: string = user?.profile?.name ?? 'Anonymous';`
    },
    python: {
      pattern: 'getattr or dict.get with default',
      example: `name = getattr(getattr(user, 'profile', None), 'name', 'Anonymous')`
    },
    rust: {
      pattern: 'Option<T> with map and unwrap_or',
      example: `let name = user.profile.as_ref().and_then(|p| p.name.as_ref()).unwrap_or(&"Anonymous".to_string());`
    },
    kotlin: {
      pattern: 'value?.property ?: default',
      example: `val name = user?.profile?.name ?: "Anonymous"`
    },
    swift: {
      pattern: 'value?.property ?? default',
      example: `let name = user?.profile?.name ?? "Anonymous"`
    }
  },

  error_handling: {
    javascript: {
      pattern: 'try { } catch (error) { }',
      example: `try {
  const data = await fetchData();
  return data;
} catch (error) {
  console.error('Failed:', error);
  throw error;
}`
    },
    python: {
      pattern: 'try: except Exception:',
      example: `try:
    data = await fetch_data()
    return data
except Exception as error:
    print(f'Failed: {error}')
    raise`
    },
    rust: {
      pattern: 'Result<T, E> with ? operator',
      example: `fn process() -> Result<Data, Error> {
    let data = fetch_data()?;
    Ok(data)
}`
    },
    go: {
      pattern: 'if err != nil { return }',
      example: `data, err := fetchData()
if err != nil {
    log.Printf("Failed: %v", err)
    return nil, err
}
return data, nil`
    }
  },

  class_definition: {
    javascript: {
      pattern: 'class Name { constructor() {} }',
      example: `class User {
  constructor(name, email) {
    this.name = name;
    this.email = email;
  }
  
  greet() {
    return \`Hello, \${this.name}!\`;
  }
}`
    },
    python: {
      pattern: 'class Name: def __init__(self):',
      example: `class User:
    def __init__(self, name: str, email: str):
        self.name = name
        self.email = email
    
    def greet(self) -> str:
        return f"Hello, {self.name}!"`
    },
    rust: {
      pattern: 'struct Name { } impl Name { }',
      example: `struct User {
    name: String,
    email: String,
}

impl User {
    fn new(name: String, email: String) -> Self {
        User { name, email }
    }
    
    fn greet(&self) -> String {
        format!("Hello, {}!", self.name)
    }
}`
    },
    go: {
      pattern: 'type Name struct { } func (n *Name) Method()',
      example: `type User struct {
    Name  string
    Email string
}

func NewUser(name, email string) *User {
    return &User{Name: name, Email: email}
}

func (u *User) Greet() string {
    return fmt.Sprintf("Hello, %s!", u.Name)
}`
    }
  }
};

// Idiomatic differences notes
const IDIOM_NOTES = {
  javascript_to_python: [
    'Use snake_case for variables and functions',
    'No semicolons needed',
    'Use None instead of null/undefined',
    'Indentation is syntactically significant',
    'Use list comprehensions instead of map/filter chains'
  ],
  javascript_to_rust: [
    'All variables are immutable by default (use mut for mutable)',
    'Explicit types required (or let the compiler infer)',
    'No garbage collector - learn ownership and borrowing',
    'Use Result<T, E> for error handling instead of try/catch',
    'String types: &str (borrowed) vs String (owned)'
  ],
  javascript_to_go: [
    'No classes - use structs with methods',
    'Error handling via multiple return values',
    'No generics (until Go 1.18+)',
    'Concurrent programming with goroutines',
    'Strict formatting enforced by gofmt'
  ],
  python_to_javascript: [
    'Use camelCase for variables and functions',
    'Semicolons optional but common',
    'Use null instead of None',
    'Braces required for blocks',
    'Use array methods for functional programming'
  ]
};

class UniversalTranslator {
  constructor() {
    this.languages = LANGUAGES;
    this.patterns = PATTERN_MAPPINGS;
    this.translations = [];
    this.listeners = new Set();
  }

  /**
   * Get all supported languages
   */
  getSupportedLanguages() {
    return Object.values(this.languages);
  }

  /**
   * Detect language from code
   */
  detectLanguage(code) {
    const indicators = {
      javascript: [/const\s+\w+\s*=/, /let\s+\w+\s*=/, /=>\s*{/, /require\s*\(/, /module\.exports/],
      typescript: [/:\s*(string|number|boolean|any)\b/, /interface\s+\w+/, /<\w+>/, /as\s+\w+/],
      python: [/def\s+\w+\s*\(/, /import\s+\w+/, /from\s+\w+\s+import/, /self\./],
      rust: [/fn\s+\w+/, /let\s+mut/, /impl\s+\w+/, /pub\s+fn/, /->/, /::/, /&str/],
      go: [/func\s+\w+/, /package\s+\w+/, /:=/, /import\s+\(/, /chan\s+/],
      java: [/public\s+class/, /private\s+\w+/, /System\.out/, /void\s+main/],
      csharp: [/namespace\s+\w+/, /public\s+class/, /Console\./, /using\s+\w+;/],
      ruby: [/def\s+\w+/, /end\b/, /puts\s+/, /@\w+/, /require\s+['"]/],
      php: [/<\?php/, /\$\w+/, /function\s+\w+/, /echo\s+/],
      swift: [/func\s+\w+/, /var\s+\w+:/, /let\s+\w+:/, /guard\s+let/],
      kotlin: [/fun\s+\w+/, /val\s+\w+/, /var\s+\w+:/, /object\s+\w+/]
    };

    const scores = {};
    
    for (const [lang, patterns] of Object.entries(indicators)) {
      scores[lang] = patterns.filter(pattern => pattern.test(code)).length;
    }

    const detected = Object.entries(scores)
      .filter(([_, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])[0];

    return detected ? detected[0] : null;
  }

  /**
   * Detect pattern type in code
   */
  detectPattern(code) {
    const patternIndicators = {
      async_await: [/async\s+function/, /await\s+/, /\.then\s*\(/],
      array_map: [/\.map\s*\(/, /for.*in/, /list comprehension/],
      array_filter: [/\.filter\s*\(/, /if.*for/, /where/],
      null_check: [/\?\?/, /\?\./,  /is\s+None/, /== null/],
      error_handling: [/try\s*{/, /catch\s*\(/, /except\s*:/,  /Result</],
      class_definition: [/class\s+\w+/, /struct\s+\w+/, /type\s+\w+\s+struct/]
    };

    for (const [pattern, indicators] of Object.entries(patternIndicators)) {
      if (indicators.some(i => i.test(code))) {
        return pattern;
      }
    }

    return null;
  }

  /**
   * Get pattern equivalent in target language
   */
  getPatternEquivalent(patternName, targetLanguage) {
    const pattern = this.patterns[patternName];
    if (!pattern) return null;

    return pattern[targetLanguage] || null;
  }

  /**
   * Translate code concept between languages
   */
  translateConcept(code, sourceLanguage, targetLanguage) {
    const sourceLang = sourceLanguage || this.detectLanguage(code);
    if (!sourceLang) {
      return { error: 'Could not detect source language' };
    }

    const pattern = this.detectPattern(code);
    
    const translation = {
      id: `trans_${Date.now()}`,
      sourceCode: code,
      sourceLanguage: sourceLang,
      targetLanguage,
      detectedPattern: pattern,
      timestamp: Date.now()
    };

    // Get pattern equivalent
    if (pattern && this.patterns[pattern]) {
      const targetPattern = this.patterns[pattern][targetLanguage];
      const sourcePattern = this.patterns[pattern][sourceLang];

      translation.patternMapping = {
        sourceName: sourcePattern?.pattern || 'Unknown pattern',
        targetName: targetPattern?.pattern || 'No direct equivalent',
        sourceExample: sourcePattern?.example,
        targetExample: targetPattern?.example
      };
    }

    // Get idiomatic differences
    const idiomKey = `${sourceLang}_to_${targetLanguage}`;
    translation.idiomaticNotes = IDIOM_NOTES[idiomKey] || [];

    // Generate conceptual translation
    translation.conceptualTranslation = this.generateConceptualTranslation(
      code, sourceLang, targetLanguage, pattern
    );

    this.translations.push(translation);
    this.notifyListeners();

    return translation;
  }

  /**
   * Generate conceptual translation explanation
   */
  generateConceptualTranslation(code, sourceLang, targetLang, pattern) {
    const differences = [];

    // Analyze code structure
    if (code.includes('class ')) {
      if (targetLang === 'go') {
        differences.push('Go uses structs with methods instead of classes');
      } else if (targetLang === 'rust') {
        differences.push('Rust uses struct + impl blocks instead of classes');
      }
    }

    if (code.includes('async') || code.includes('await')) {
      if (targetLang === 'go') {
        differences.push('Go uses goroutines and channels for concurrency');
      } else if (targetLang === 'rust') {
        differences.push('Rust uses async/await with explicit runtime (tokio/async-std)');
      }
    }

    if (code.includes('try') || code.includes('catch')) {
      if (targetLang === 'rust') {
        differences.push('Rust uses Result<T, E> with ? operator instead of exceptions');
      } else if (targetLang === 'go') {
        differences.push('Go uses explicit error returns instead of exceptions');
      }
    }

    if (code.includes('.map(') || code.includes('.filter(')) {
      if (targetLang === 'go') {
        differences.push('Go typically uses for loops instead of functional methods');
      } else if (targetLang === 'python') {
        differences.push('Python prefers list comprehensions for map/filter');
      }
    }

    return {
      keyDifferences: differences,
      pattern: pattern ? this.patterns[pattern]?.[targetLang] : null
    };
  }

  /**
   * Get all patterns for a language
   */
  getPatternsForLanguage(language) {
    const result = {};
    
    for (const [patternName, languages] of Object.entries(this.patterns)) {
      if (languages[language]) {
        result[patternName] = languages[language];
      }
    }
    
    return result;
  }

  /**
   * Compare pattern across all languages
   */
  comparePattern(patternName) {
    const pattern = this.patterns[patternName];
    if (!pattern) return null;

    return {
      patternName,
      languages: Object.entries(pattern).map(([lang, info]) => ({
        language: lang,
        languageInfo: this.languages[lang],
        ...info
      }))
    };
  }

  /**
   * Get all available patterns
   */
  getAvailablePatterns() {
    return Object.keys(this.patterns).map(key => ({
      id: key,
      name: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      languages: Object.keys(this.patterns[key])
    }));
  }

  /**
   * Get translation history
   */
  getHistory() {
    return [...this.translations].reverse();
  }

  /**
   * Clear history
   */
  clearHistory() {
    this.translations = [];
    this.notifyListeners();
  }

  /**
   * Add listener
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify listeners
   */
  notifyListeners() {
    const state = {
      languages: this.getSupportedLanguages(),
      patterns: this.getAvailablePatterns(),
      history: this.translations.slice(-10)
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Universal translator listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getUniversalTranslator() {
  if (!instance) {
    instance = new UniversalTranslator();
  }
  return instance;
}

export { LANGUAGES, PATTERN_MAPPINGS, IDIOM_NOTES };
export default UniversalTranslator;
