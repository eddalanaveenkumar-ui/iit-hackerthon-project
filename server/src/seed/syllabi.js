/** Realistic demo syllabi used by the seed script. */

export const JAVA_SYLLABUS = {
  title: 'Java Programming — Semester Syllabus',
  subjects: [
    {
      name: 'Java Programming',
      description: 'Core language, object orientation and collections.',
      units: [
        {
          name: 'Unit 1 – Introduction to Java',
          description: 'Platform basics, compilation model, primitive types.',
          concepts: [
            {
              name: 'Variables and Primitive Types',
              description: 'Java is statically typed: every variable has a declared type known at compile time. Primitives (byte, short, int, long, float, double, char, boolean) store values directly; their size and range are fixed by the JVM specification.',
              objectives: ['Declare variables of each primitive type', 'Explain overflow and integer division', 'Choose the correct type for a value range'],
              keywords: ['int', 'double', 'boolean', 'overflow', 'casting', 'scope'],
              subtopics: ['Primitive vs reference types', 'Type promotion', 'Integer division and modulo'],
            },
            {
              name: 'Control Flow',
              description: 'if/else, switch, and loops control which statements execute. Java requires boolean conditions (no truthiness), and switch supports fall-through unless break is used.',
              objectives: ['Write nested conditionals', 'Use switch with break correctly', 'Convert a loop into an equivalent while loop'],
              keywords: ['if', 'switch', 'for', 'while', 'break', 'fall-through'],
              subtopics: ['Truthiness does not exist in Java', 'Off-by-one errors', 'do-while semantics'],
            },
            {
              name: 'Methods and Parameters',
              description: 'Methods encapsulate behaviour. Java is pass-by-value, which for object references means the reference is copied, not the object.',
              objectives: ['Define methods with parameters and return values', 'Explain pass-by-value for primitives and references', 'Overload methods correctly'],
              keywords: ['method', 'return', 'parameters', 'overloading', 'pass-by-value'],
              subtopics: ['Method signature', 'Varargs', 'Recursion basics'],
            },
          ],
        },
        {
          name: 'Unit 2 – Objects and Classes',
          description: 'Encapsulation, constructors, inheritance basics.',
          concepts: [
            {
              name: 'Classes and Constructors',
              description: 'A class is a blueprint. A constructor initialises a new object and shares the class name with no return type. If no constructor is declared, Java provides a default no-arg constructor — but declaring any constructor removes that default.',
              objectives: ['Write constructors with validation', 'Explain why a default constructor disappears', 'Use this() to chain constructors'],
              keywords: ['class', 'constructor', 'this', 'instance', 'new'],
              subtopics: ['Constructor chaining', 'Initialisation order', 'Static vs instance members'],
            },
            {
              name: 'Encapsulation and Access Modifiers',
              description: 'private fields with public methods protect invariants. Access modifiers control visibility at class, package and subclass level.',
              objectives: ['Justify getters/setters', 'Choose the right access modifier', 'Explain the difference between private and protected'],
              keywords: ['private', 'public', 'protected', 'getter', 'invariant'],
              subtopics: ['Package-private', 'Encapsulation vs data hiding'],
            },
            {
              name: 'Inheritance and Polymorphism',
              description: 'Inheritance models an is-a relationship. Method overriding resolves at runtime (dynamic dispatch); overloading resolves at compile time.',
              objectives: ['Distinguish overriding from overloading', 'Predict which method runs', 'Use super correctly'],
              keywords: ['extends', 'override', 'super', 'polymorphism', 'dynamic dispatch'],
              subtopics: ['Covariant return types', 'Abstract classes', 'Composition over inheritance'],
            },
          ],
        },
        {
          name: 'Unit 3 – Collections and Error Handling',
          description: 'Arrays, ArrayList, maps, exceptions.',
          concepts: [
            {
              name: 'Arrays and ArrayLists',
              description: 'Arrays are fixed-size with O(1) indexing. ArrayList grows dynamically, uses an internal array with amortised O(1) append, and cannot hold primitives directly (autoboxing).',
              objectives: ['Choose between array and ArrayList', 'Explain autoboxing cost', 'Traverse a collection safely'],
              keywords: ['array', 'ArrayList', 'autoboxing', 'index', 'growth'],
              subtopics: ['ArrayIndexOutOfBounds', 'ConcurrentModificationException'],
            },
            {
              name: 'Exceptions and Error Handling',
              description: 'Checked exceptions must be declared or caught; unchecked exceptions indicate programming errors. try-with-resources closes resources deterministically.',
              objectives: ['Choose checked vs unchecked', 'Use try/catch/finally correctly', 'Explain why catch(Exception) is risky'],
              keywords: ['exception', 'checked', 'unchecked', 'finally', 'resources'],
              subtopics: ['Custom exceptions', 'Exception chaining'],
            },
            {
              name: 'HashMaps and Equals/HashCode',
              description: 'HashMap buckets by hashCode and compares with equals. Overriding equals without hashCode breaks lookups because equal objects land in different buckets.',
              objectives: ['Explain bucket lookup', 'Implement equals and hashCode consistently', 'Choose HashMap vs TreeMap'],
              keywords: ['HashMap', 'hashCode', 'equals', 'bucket', 'collision'],
              subtopics: ['Load factor', 'TreeMap ordering', 'Mutable keys hazard'],
            },
          ],
        },
      ],
    },
  ],
};

export const ML_SYLLABUS = {
  title: 'Machine Learning Foundations',
  subjects: [
    {
      name: 'Machine Learning',
      description: 'Supervised learning foundations through evaluation.',
      units: [
        {
          name: 'Unit 1 – Foundations',
          description: 'Linear models and the training loop.',
          concepts: [
            {
              name: 'Linear Regression',
              description: 'Linear regression fits y = Xw + b by minimising mean squared error. The closed form exists but gradient descent scales better; feature scaling changes convergence speed, not the optimum.',
              objectives: ['Derive the MSE gradient', 'Explain the effect of learning rate', 'Detect underfitting vs overfitting'],
              keywords: ['MSE', 'gradient descent', 'learning rate', 'features', 'bias'],
              subtopics: ['Normal equation', 'Feature scaling', 'Regularisation intro'],
            },
            {
              name: 'Bias–Variance Trade-off',
              description: 'High bias underfits, high variance overfits. Model complexity moves the error between the two; validation curves show which side you are on.',
              objectives: ['Diagnose bias vs variance from learning curves', 'Suggest a fix for each', 'Explain why more data fixes variance, not bias'],
              keywords: ['bias', 'variance', 'overfitting', 'underfitting', 'validation'],
              subtopics: ['Learning curves', 'Cross-validation'],
            },
          ],
        },
        {
          name: 'Unit 2 – Classification',
          description: 'Logistic regression and classification metrics.',
          concepts: [
            {
              name: 'Logistic Regression',
              description: 'Logistic regression models log-odds as a linear function and squashes through the sigmoid. Outputs are probabilities; the decision threshold is a separate business choice.',
              objectives: ['Explain the sigmoid transform', 'Interpret coefficients as log-odds', 'Choose a threshold deliberately'],
              keywords: ['sigmoid', 'log-odds', 'threshold', 'probability', 'cross-entropy'],
              subtopics: ['Maximum likelihood', 'Class imbalance'],
            },
            {
              name: 'Precision, Recall and F1',
              description: 'Precision measures purity of positive predictions; recall measures coverage of actual positives. F1 is their harmonic mean. Accuracy is misleading on imbalanced data.',
              objectives: ['Compute all three from a confusion matrix', 'Choose the metric that matches the cost of errors', 'Explain the accuracy paradox'],
              keywords: ['precision', 'recall', 'F1', 'confusion matrix', 'imbalance'],
              subtopics: ['ROC-AUC', 'Threshold tuning'],
            },
          ],
        },
        {
          name: 'Unit 3 – Evaluation and Overfitting',
          description: 'Validation strategy and regularisation.',
          concepts: [
            {
              name: 'Cross-Validation',
              description: 'k-fold cross-validation estimates generalisation by training k times on different splits. Data leakage (scaling or feature selection before the split) inflates scores.',
              objectives: ['Set up a correct k-fold split', 'Spot data leakage', 'Explain stratification'],
              keywords: ['k-fold', 'leakage', 'stratification', 'holdout', 'variance'],
              subtopics: ['Leave-one-out', 'Nested cross-validation'],
            },
            {
              name: 'Regularisation (L1/L2)',
              description: 'L1 shrinks some weights exactly to zero (sparsity); L2 shrinks all weights smoothly. The penalty strength controls the bias-variance balance.',
              objectives: ['Distinguish L1 and L2 effects', 'Tune penalty strength', 'Explain why L1 performs selection'],
              keywords: ['L1', 'L2', 'lasso', 'ridge', 'penalty'],
              subtopics: ['Elastic net', 'Geometric intuition'],
            },
          ],
        },
      ],
    },
  ],
};

export const WEB_SYLLABUS = {
  title: 'Modern Web Development',
  subjects: [
    {
      name: 'Web Development',
      description: 'JavaScript fundamentals, DOM and async data.',
      units: [
        {
          name: 'Unit 1 – JavaScript Fundamentals',
          description: 'Types, scope and arrays.',
          concepts: [
            {
              name: 'Scope and Closures',
              description: 'let/const are block scoped, var is function scoped. A closure captures the variable binding, not its value, which is why loop callbacks with var all see the final value.',
              objectives: ['Predict output of nested function scopes', 'Fix the classic var-in-loop bug', 'Explain lexical scoping'],
              keywords: ['closure', 'scope', 'var', 'let', 'hoisting'],
              subtopics: ['Temporal dead zone', 'IIFE'],
            },
            {
              name: 'Array Methods (map/filter/reduce)',
              description: 'map transforms, filter selects, reduce folds. They return new arrays (except reduce) and do not mutate the source unless you do.',
              objectives: ['Rewrite a for-loop with reduce', 'Chain methods without mutating input', 'Explain the reducer signature'],
              keywords: ['map', 'filter', 'reduce', 'immutability', 'callback'],
              subtopics: ['Immutability', 'Performance of chains'],
            },
          ],
        },
        {
          name: 'Unit 2 – Asynchronous JavaScript',
          description: 'Promises, async/await and error paths.',
          concepts: [
            {
              name: 'Promises and async/await',
              description: 'A Promise represents a future value. async functions return Promises; await pauses that function only. Unhandled rejections crash modern Node processes.',
              objectives: ['Convert callback code to promises', 'Handle errors in async functions', 'Run requests in parallel correctly'],
              keywords: ['Promise', 'async', 'await', 'rejection', 'then'],
              subtopics: ['Promise.all vs allSettled', 'Microtask queue'],
            },
            {
              name: 'Fetch and HTTP Semantics',
              description: 'fetch resolves even on 4xx/5xx — you must check response.ok yourself. JSON parsing is a second async step.',
              objectives: ['Check response status correctly', 'Explain idempotency of HTTP verbs', 'Handle network failure vs HTTP error'],
              keywords: ['fetch', 'status', 'ok', 'JSON', 'idempotent'],
              subtopics: ['CORS', 'AbortController'],
            },
          ],
        },
        {
          name: 'Unit 3 – React Essentials',
          description: 'Components, state and effects.',
          concepts: [
            {
              name: 'Components, Props and State',
              description: 'Props flow down, state lives in a component and triggers re-render when replaced (not when mutated).',
              objectives: ['Lift state correctly', 'Explain why mutation does not re-render', 'Choose between state and derived value'],
              keywords: ['props', 'state', 'render', 'immutable', 'lift'],
              subtopics: ['Controlled inputs', 'Keys in lists'],
            },
            {
              name: 'useEffect and Dependencies',
              description: 'useEffect runs after render; the dependency array controls when. Missing dependencies cause stale closures; unstable objects cause infinite loops.',
              objectives: ['Explain the dependency array', 'Avoid infinite effect loops', 'Clean up subscriptions'],
              keywords: ['useEffect', 'dependency', 'cleanup', 'stale closure', 'effect'],
              subtopics: ['Strict mode double-invoke', 'Data fetching patterns'],
            },
          ],
        },
      ],
    },
  ],
};
