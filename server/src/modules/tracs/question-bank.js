/**
 * QUESTION BANK
 * =============
 *
 * Real questions for the topics a syllabus actually contains, used when no model
 * is configured. Without a key the engine used to fall back to
 *
 *     What is the main idea of "Variables and Data Types"?
 *     a) The core definition of Variables and Data Types   ← always correct
 *     b) It is unrelated to the rest of the syllabus
 *     c) It only applies to advanced students
 *     d) It has no practical use
 *
 * which is not a question. The answer is always (a), the distractors are
 * absurdities, and it teaches nothing — the learner learns that the first option
 * is correct, which is a habit worth avoiding.
 *
 * This is the opposite: for each well-known concept, a stem that asks something
 * specific, one defensibly correct answer, and distractors that are *wrong for a
 * reason a student plausibly holds*. Every entry is checked by a test that
 * asserts the distractors are distinct from the answer and from each other.
 *
 * The bank is a fallback, not the intended path. With a model configured the
 * questions are authored from the learner's own syllabus excerpt; this exists so
 * that the product is honest and useful without one.
 */

/**
 * @typedef {object} Fact
 * @property {RegExp} match    tested against `${topic.title} ${topic.unit}` lowercased
 * @property {string} label    the concept name, used in the prompt
 * @property {string} ask      what the question asks, in one sentence
 * @property {string} answer   the correct option
 * @property {string[]} wrong  plausible wrong answers
 * @property {string} explain  why the answer is right, shown after grading
 * @property {string} [code]   a correct snippet, for concepts that are codeable
 * @property {string} [print]  expected stdout for that snippet
 */

/** @type {Fact[]} */
export const FACTS = [
  /* ---- Python / Java fundamentals ------------------------------------- */
  {
    lang: 'python',
    match: /variables? (and|&) data ?types?|data ?types?|primitive types?/,
    label: 'Variables and data types',
    ask: 'A variable is assigned 7 and later assigned 7.5. What happens in Python?',
    answer: 'The same name now refers to a float — Python variables are names bound to objects, not typed boxes',
    wrong: [
      'A type error is raised because the variable was already an int',
      'The value stays 7 and the second assignment is ignored',
      'Python converts 7.5 to the integer 7 to keep the type stable',
    ],
    explain: 'A Python name is a reference. Rebinding it to a float is allowed; the name simply points at a different object.',
    code: 'x = 7\nx = 7.5\nprint(type(x).__name__)',
    print: 'float',
  },
  {
    lang: 'python',
    match: /type casting|type conversion|casting|coercion/,
    label: 'Type casting',
    ask: 'In Python, what does `int("12.7")` do?',
    answer: 'Raises ValueError, because int() will not parse a decimal string',
    wrong: [
      'Returns 12, truncating the decimal part',
      'Returns 13, rounding to the nearest integer',
      'Returns 12.7 as a float',
    ],
    explain: '`int()` accepts a string of digits. For "12.7" you must go through `float("12.7")` first, then `int(...)`.',
    code: 'print(int(float("12.7")))',
    print: '12',
  },
  {
    lang: 'python',
    match: /operators? (and|&) expressions?|arithmetic operators?|expressions?/,
    label: 'Operators and expressions',
    ask: 'What does `7 // 2` evaluate to in Python 3?',
    answer: '3 — floor division discards the remainder',
    wrong: ['3.5 — it is ordinary division', '4 — it rounds to the nearest whole number', '1 — it returns the remainder'],
    explain: '`//` floors toward negative infinity, so 7 // 2 is 3. Ordinary division `7 / 2` is 3.5.',
    code: 'print(7 // 2)',
    print: '3',
  },
  {
    lang: 'python',
    match: /input (and|&) output|print(ing)?|console output|io\b/,
    label: 'Input and output',
    ask: 'What is the type of the value returned by `input()` in Python?',
    answer: 'A string, always — even if the user types digits',
    wrong: ['An integer when the user types digits', 'Whatever type the program expects', 'None, because input is a side effect'],
    explain: '`input()` always returns a string. Numbers need `int(...)` or `float(...)` around it.',
    code: 'age = input()\nprint(type(age).__name__)',
    print: 'str',
  },

  /* ---- control flow ---------------------------------------------------- */
  {
    lang: 'python',
    match: /conditionals?|if statements?|branching|decision/,
    label: 'Conditionals',
    ask: 'What does this print?\n`x = 0` then `if x: print("yes") else: print("no")`',
    answer: 'no — 0 is falsy, and an `if` tests truthiness, not existence',
    wrong: [
      'yes — the variable exists, so the branch is taken',
      'A TypeError, because 0 cannot be tested as a condition',
      'Nothing — the `else` branch only runs when the variable is undefined',
    ],
    explain: '0, "", [] and None are falsy in Python. `if x` tests the value, not whether x is defined.',
    code: 'x = 0\nprint("yes" if x else "no")',
    print: 'no',
  },
  {
    match: /loops? (and|&) iteration|for loops?|while loops?|iteration|iterate/,
    label: 'Loops and iteration',
    ask: 'How many times does `for i in range(3)` run its body?',
    answer: 'Three times, with i as 0, 1 and 2',
    wrong: ['Three times, with i as 1, 2 and 3', 'Four times, because the end value is included', 'Twice, because range excludes both ends'],
    explain: '`range(3)` starts at 0 and stops *before* 3: 0, 1, 2.',
    code: 'total = 0\nfor i in range(3):\n    total += i\nprint(total)',
    print: '3',
  },
  {
    match: /loop control|break|continue|nested loops?/,
    label: 'Loop control statements',
    ask: 'Inside a loop over 1 to 5, `continue` is hit when the number is even. What is printed?',
    answer: 'Only the odd numbers — `continue` skips to the next iteration',
    wrong: [
      'Only the even numbers — `continue` prints them',
      'Nothing after the first even number, because the loop ends',
      'Every number, because `continue` is a no-op',
    ],
    explain: '`continue` abandons the rest of the current iteration and goes to the next one. `break` ends the loop entirely.',
    code: 'for n in range(1, 6):\n    if n % 2 == 0:\n        continue\n    print(n)',
    print: '1\n3\n5',
  },

  /* ---- functions ------------------------------------------------------- */
  {
    lang: 'python',
    match: /defining (functions|methods)|functions?|methods?/,
    label: 'Defining functions',
    ask: 'A function has no `return` statement. What does it return?',
    answer: 'None — Python returns None implicitly',
    wrong: ['The last expression evaluated in the function', 'An empty string', 'A ValueError is raised for a missing return'],
    explain: 'Falling off the end of a function returns None. `return` is explicit.',
    code: 'def f():\n    x = 1\nprint(f())',
    print: 'None',
  },
  {
    match: /arguments? (and|&) return|parameters?|return values?|passing arguments/,
    label: 'Arguments and return values',
    ask: 'What does this print?\n`def add(a, b=2): return a + b` then `print(add(3))`',
    answer: '5 — b falls back to its default of 2',
    wrong: ['A TypeError, because add expects two arguments', '3 — the missing argument becomes 0', 'TypeError: b is required when a is given'],
    explain: 'A parameter with a default is optional at the call site.',
    code: 'def add(a, b=2):\n    return a + b\nprint(add(3))',
    print: '5',
  },
  {
    lang: 'python',
    match: /method overloading|overloading/,
    label: 'Method overloading',
    ask: 'Java allows `add(int, int)` and `add(int, int, int)` as overloads. Can Python do the same?',
    answer: 'No — later definitions replace earlier ones, so Python uses default arguments or *args instead',
    wrong: [
      'Yes, exactly as in Java, chosen by argument count',
      'Yes, but only inside a class',
      'No, because Python has no functions',
    ],
    explain: 'Python binds one object per name. Two `def add` in the same scope: the second wins. Use defaults or `*args`.',
  },
  {
    match: /scope|recursion|closures?/,
    label: 'Scope and recursion',
    ask: 'Every recursive function must have what?',
    answer: 'A base case that returns without recursing, or it never terminates',
    wrong: [
      'A loop inside it',
      'A global variable counting the calls',
      'A return type annotation',
    ],
    explain: 'Recursion needs a stopping condition. Without a base case the stack grows until the interpreter gives up.',
    code: 'def fact(n):\n    return 1 if n <= 1 else n * fact(n - 1)\nprint(fact(4))',
    print: '24',
  },

  /* ---- data structures ------------------------------------------------- */
  {
    lang: 'python',
    match: /lists? (and|&) tuples?|lists?|tuples?/,
    label: 'Lists and tuples',
    ask: 'What is the difference between a list and a tuple in Python?',
    answer: 'A tuple cannot be modified after creation; a list can',
    wrong: [
      'A tuple can hold only numbers, a list can hold anything',
      'A list cannot be indexed, a tuple can',
      'They are identical apart from the brackets used',
    ],
    explain: 'Tuples are immutable. That also makes them hashable, so they can be dictionary keys.',
    code: 't = (1, 2, 3)\nprint(len(t))',
    print: '3',
  },
  {
    match: /dictionaries?|dicts?|sets?|hash ?maps?|maps?/,
    label: 'Dictionaries and sets',
    ask: 'What happens when you read a key that is not in a dict, with `d["missing"]`?',
    answer: 'KeyError — use `d.get("missing")` to get None instead',
    wrong: ['It returns None', 'It returns an empty string', 'It adds the key with a default value'],
    explain: '`[]` raises KeyError. `.get()` returns None (or a default you pass).',
    code: 'd = {"a": 1}\nprint(d.get("b", "absent"))',
    print: 'absent',
  },
  {
    lang: 'python',
    match: /arrays?|indexing|slicing/,
    label: 'Arrays and indexing',
    ask: 'In Python, what does `[10, 20, 30, 40][1:3]` return?',
    answer: '[20, 30] — the start is included, the end is excluded',
    wrong: ['[20, 30, 40]', '[10, 20, 30]', '[30, 40]'],
    explain: 'A slice runs from the start index up to, but not including, the end index.',
    code: 'print(len([10, 20, 30, 40][1:3]))',
    print: '2',
  },
  {
    lang: 'python',
    match: /strings? (and|&) slicing|string handling|string methods/,
    label: 'Strings and slicing',
    ask: 'Are Python strings mutable — can you assign to `s[0]`?',
    answer: 'No, strings are immutable; you build a new string instead',
    wrong: ['Yes, indexing assigns a new character', 'Yes, but only for single-character strings', 'Only if the string was created with str()'],
    explain: 'Strings are immutable. `s[0] = "x"` raises TypeError; use slicing and concatenation.',
    code: 's = "abc"\nprint(s.upper())',
    print: 'ABC',
  },

  /* ---- OOP (Java and Python share the vocabulary) ---------------------- */
  {
    match: /classes? (and|&) objects?|classes?|objects?|instances?/,
    label: 'Classes and objects',
    ask: 'What is the relationship between a class and an object?',
    answer: 'A class is the definition; an object is one instance created from it',
    wrong: [
      'An object is the definition; a class is one instance of it',
      'They are two names for the same thing',
      'A class can only be created from an object',
    ],
    explain: 'The class describes the data and behaviour; each object holds its own state.',
  },
  {
    match: /inheritance|subclass|superclass|extends/,
    label: 'Inheritance',
    ask: 'A subclass overrides a method. Which version runs when called on a subclass instance?',
    answer: 'The subclass version — the most derived implementation wins',
    wrong: ['The superclass version, because it was defined first', 'Both run, superclass first', 'Neither; it must be called explicitly'],
    explain: 'Method resolution starts at the object’s own class. Call `super()` to reach the parent version explicitly.',
  },
  {
    match: /polymorphism|overriding/,
    label: 'Polymorphism',
    ask: 'Two classes both implement `area()`. Code calls `shape.area()` on a list of them. Why does this work?',
    answer: 'Each object resolves `area()` on its own class at runtime',
    wrong: [
      'Because the compiler picks one implementation for the whole list',
      'Because area() must be a global function',
      'It does not work unless both classes are identical',
    ],
    explain: 'That is polymorphism: one call site, many implementations, chosen by the object.',
  },
  {
    match: /encapsulation|access modifiers?|private|public/,
    label: 'Encapsulation',
    ask: 'Why keep a field private and expose it through a method?',
    answer: 'So the class controls how the value changes and can validate it',
    wrong: [
      'Because private fields use less memory',
      'Because public fields cannot be read at all',
      'Because it makes the program run faster',
    ],
    explain: 'Encapsulation protects invariants: every write goes through code you control.',
  },

  /* ---- errors and files ------------------------------------------------ */
  {
    match: /exceptions?|error handling|try.?catch|try.?except/,
    label: 'Exceptions and error handling',
    ask: '`try: 1/0` — which exception is raised?',
    answer: 'ZeroDivisionError',
    wrong: ['ValueError', 'TypeError', 'ArithmeticError raised directly, not a subclass'],
    explain: 'Integer division by zero raises ZeroDivisionError. `except ArithmeticError` would also catch it, since it is the parent.',
    code: 'try:\n    1 / 0\nexcept ZeroDivisionError:\n    print("caught")',
    print: 'caught',
  },
  {
    match: /reading (and|&) writing files|file (io|handling)|files?\b/,
    label: 'Reading and writing files',
    ask: 'Why open a file with `with open(...) as f:` rather than `f = open(...)`?',
    answer: 'The `with` block closes the file even if an exception is raised',
    wrong: [
      'It makes the file read faster',
      'It is required for files larger than 1 MB',
      'It locks the file so other programs cannot read it',
    ],
    explain: 'A context manager guarantees cleanup. A bare `open` leaks the handle if the body raises.',
    code: 'with open("f.txt", "w") as f:\n    f.write("hi")\nwith open("f.txt") as f:\n    print(f.read())',
    print: 'hi',
  },
  /* ---- Java ----------------------------------------------------------- */
  {
    lang: 'java',
    match: /variables? (and|&) (data ?types?|primitive types?)|data ?types?|primitive types?/,
    label: 'Variables and primitive types',
    ask: 'Java has `int total = 7;` and later `total = 7.5;`. What happens?',
    answer: 'It does not compile — 7.5 is a double and does not fit in an int without a cast',
    wrong: [
      'total quietly becomes the double 7.5',
      'total keeps the value 7 and the assignment is ignored',
      'It compiles, but 7.5 is rounded to 8 at run time',
    ],
    explain: 'Java is statically typed: the variable has one fixed type. Storing a double in an int needs an explicit cast, `total = (int) 7.5;`, which truncates to 7.',
  },
  {
    lang: 'java',
    match: /type casting|type conversion|casting|coercion/,
    label: 'Type casting',
    ask: 'In Java, what does `(int) 3.99` evaluate to?',
    answer: '3 — the cast truncates towards zero, it does not round',
    wrong: [
      '4 — it rounds to the nearest integer',
      '3.99 — the cast has no effect on a double',
      'It throws a ClassCastException',
    ],
    explain: 'A narrowing primitive cast discards the fractional part. Use `Math.round(3.99)` if you want 4.',
    code: 'System.out.println("ok")',
    print: 'ok',
  },
  {
    lang: 'java',
    match: /operators? (and|&) expressions?|arithmetic operators?|expressions?/,
    label: 'Operators and expressions',
    ask: 'In Java, what is the value of `7 / 2` when both operands are `int`?',
    answer: '3 — integer division discards the remainder',
    wrong: ['3.5 — division always produces a decimal', '4 — it rounds to the nearest integer', 'It throws ArithmeticException'],
    explain: 'Both operands are int, so the result is int and the remainder is dropped. Use `7 / 2.0` to get 3.5.',
    code: 'System.out.println("ok")',
    print: 'ok',
  },
  {
    lang: 'java',
    match: /conditionals?|if ?else|decision making|branching/,
    label: 'Conditionals',
    ask: 'In Java, which expression is a compile error inside `if ( ... )`?',
    answer: '`if (count = 0)` — an assignment produces an int, not a boolean',
    wrong: [
      '`if (count == 0)` — comparing two ints is fine',
      '`if (name.equals("x"))` — calling a method is fine',
      '`if (count > 0)` — comparing two ints is fine',
    ],
    explain: 'Java requires a boolean condition. `=` assigns and yields an int, so it does not compile — which is exactly what stops the classic `if (x = y)` bug that C allows.',
  },
  {
    lang: 'java',
    match: /loops? (and|&) iteration|for loop|while loop|iteration/,
    label: 'Loops and iteration',
    ask: 'What does `for (int i = 0; i < 3; i++)` print for `i` inside the body?',
    answer: '0, 1, 2 — the condition is checked before each pass',
    wrong: ['1, 2, 3', '0, 1, 2, 3', '1, 2'],
    explain: '`i` starts at 0 and the loop runs while `i < 3`, so the body sees 0, 1, 2. When `i` reaches 3 the condition fails and the body never runs again.',
  },
  {
    lang: 'java',
    match: /defining functions|methods?|functions?/,
    label: 'Defining methods',
    ask: 'In Java, what does a method with return type `void` mean?',
    answer: 'It returns nothing to the caller — the return type is void, not a value',
    wrong: [
      'It returns null by default',
      'It returns the last expression evaluated',
      'It cannot take any parameters',
    ],
    explain: '`void` states there is no return value, so `return;` is allowed but `return x;` is a compile error. It says nothing about parameters.',
  },
  {
    lang: 'java',
    match: /arrays? (and|&) indexing|arrays?|indexing/,
    label: 'Arrays and indexing',
    ask: 'In Java, what happens on `int[] a = new int[3]; a[3] = 1;`?',
    answer: 'ArrayIndexOutOfBoundsException at run time — valid indices are 0, 1, 2',
    wrong: [
      'The array grows to four elements',
      'The assignment is silently ignored',
      'A compile error — the index is checked by the compiler',
    ],
    explain: 'A Java array has a fixed length of 3, so the last valid index is 2. Index bounds are checked at run time, not compile time.',
  },
  {
    lang: 'java',
    match: /strings? (and|&) slicing|string handling|string methods/,
    label: 'Strings and slicing',
    ask: 'In Java, what does `"hello".substring(1, 3)` return?',
    answer: '"el" — the end index is excluded',
    wrong: ['"ell"', '"he"', '"ello"'],
    explain: '`substring(begin, end)` takes characters from `begin` up to but not including `end`, so indices 1 and 2 — "el".',
  },
  {
    lang: 'java',
    match: /classes? (and|&) objects?|object oriented|oop/,
    label: 'Classes and objects',
    ask: 'In Java, what is the difference between `==` and `.equals()` on two String objects?',
    answer: '`==` compares references, `.equals()` compares the characters',
    wrong: [
      'They behave identically for Strings because strings are interned',
      '`==` compares characters and `.equals()` compares references',
      '`.equals()` only works on numbers',
    ],
    explain: 'Strings are objects, so `==` asks "same object?" while `.equals()` asks "same characters?". Two equal strings built at run time are different objects.',
  },

];

/**
 * Find the facts that apply to a topic, most specific first.
 *
 * Matching is on the topic's own words. A topic that says "Loops and Iteration"
 * should get the loop question, not the conditional one, so longer/more specific
 * phrases are tried before generic ones — hence `FACTS` is ordered above from
 * specific to general within each group.
 *
 * `language` filters out questions written for another language. This matters:
 * a Java syllabus that mentions "variables and data types" was being asked
 * "A variable is assigned 7 and later assigned 7.5. What happens in Python?" —
 * the question is fine, the question *for that learner* is not. Anything not
 * tagged is language-neutral (inheritance, exceptions, files) and always applies.
 *
 * @returns {Fact[]}
 */
export function factsFor(topic, { language = null } = {}) {
  const text = `${topic?.title || ''}`.toLowerCase();
  if (!text) return [];
  return FACTS.filter((fact) => {
    if (!fact.match.test(text)) return false;
    if (!fact.lang || !language) return true;
    return fact.lang === language;
  });
}

/**
 * The language a syllabus is about.
 *
 * Used to phrase code questions correctly — asking "which Python exception" on a
 * Java syllabus is worse than asking nothing. Defaults to Python because it is
 * what the sandbox executes; Java is reported honestly as unexecuted elsewhere.
 */
export function languageFor(text) {
  const lower = String(text || '').toLowerCase();
  if (/\bjava\b(?!script)/.test(lower)) return 'java';
  if (/javascript|\bjs\b|node\.?js/.test(lower)) return 'javascript';
  return 'python';
}
