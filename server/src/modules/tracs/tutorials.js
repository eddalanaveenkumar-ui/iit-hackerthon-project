/**
 * TEACHING WITHOUT A MODEL
 * ========================
 *
 * Every explanation used to fall back to one sentence — "Conditional Statements
 * is one of the topics in your syllabus, and this syllabus does not spell it
 * out" — and then jumped straight to the two buttons. A syllabus names topics; it
 * does not teach them. The learner was being handed their own table of contents
 * back and told it was a lesson.
 *
 * This is the replacement: a real tutorial for the concepts a syllabus is usually
 * made of. Each one is built out of the pieces a person actually needs —
 *
 *   what it is        a definition in plain words, not a restatement of the title
 *   why it exists     the problem it solves, so it is not arbitrary syntax
 *   the syntax        the shape of it, small enough to hold in your head
 *   worked examples   code that runs, what it prints, and why
 *   the traps         the mistakes people actually make, with the wrong output
 *   how it is checked the mental model to test yourself against
 *
 * The entries are keyed by a pattern over the concept *title*, so they match the
 * way a syllabus names things ("Conditional Statements", "If-Else", "if
 * statements", "branching") rather than requiring an exact string. A concept
 * with no entry still gets a structured walk-through from `genericTutorial` —
 * shorter, but organised the same way and never a single sentence.
 *
 * Code is a fenced block with a language, because the renderer draws that as a
 * real block with the program separate from the prose around it.
 */

const python = (code) => `\`\`\`python\n${code}\n\`\`\``;
const java = (code) => `\`\`\`java\n${code}\n\`\`\``;

/**
 * One tutorial per concept family.
 *
 * `match` is tested against the concept's title and any prose beneath it. Order
 * matters: the first match wins, so the specific patterns come before the
 * general ones ("loop control" before "loops").
 */
export const TUTORIALS = [
  /* ---------------------------------------------------------------- if/else */
  {
    id: 'conditionals',
    label: 'Conditionals',
    match: /conditional|if[\s-]?(else|then|statement)|branching|decision making|decision structures|control flow/i,
    what: 'A conditional runs one piece of code or another depending on whether a test is true. It is how a program makes a decision instead of always doing the same thing.',
    why: 'Without a conditional, a program is a fixed list of instructions. A login check, a passing grade, a discount for a large order — every one of those is "do this only if that is so".',
    syntax: `if <condition>:\n    # runs when <condition> is True\nelif <another condition>:\n    # runs when the first was False and this one is True\nelse:\n    # runs when nothing above was True`,
    examples: [
      {
        title: 'The smallest useful conditional',
        code: `age = 20\n\nif age >= 18:\n    print("You can vote")`,
        output: 'You can vote',
        why: '`age >= 18` is a comparison, and a comparison produces a boolean — `True` here. `if` reads that value. Nothing else about the number matters to it.',
      },
      {
        title: 'Two branches',
        code: `temperature = 12\n\nif temperature > 25:\n    print("Shorts weather")\nelse:\n    print("Take a jacket")`,
        output: 'Take a jacket',
        why: '`12 > 25` is `False`, so the `if` block is skipped entirely and the `else` block runs. **Exactly one of the two blocks ever runs** — never both, never neither.',
      },
      {
        title: 'Three or more branches, still only one taken',
        code: `score = 74\n\nif score >= 90:\n    grade = "A"\nelif score >= 75:\n    grade = "B"\nelif score >= 60:\n    grade = "C"\nelse:\n    grade = "F"\n\nprint(grade)`,
        output: 'C',
        why: '`74 >= 90` is False, `74 >= 75` is False, `74 >= 60` is True, so `grade` becomes `"C"` and the remaining branches are never even looked at. That is why the order of `elif` chains matters: writing `>= 60` first would have given the same learner a "C" regardless of a higher score.',
      },
    ],
    traps: [
      {
        title: 'Using `=` where you mean `==`',
        code: `x = 5\n\n# if x = 5:      # SyntaxError in Python\nif x == 5:\n    print("five")`,
        why: '`=` stores a value; `==` compares two. Python refuses `if x = 5` outright, which is a kindness — in C and JavaScript the same typo compiles and silently assigns, so the condition becomes the assigned value.',
      },
      {
        title: 'Testing truthiness when you meant "is it empty"',
        code: `items = []\n\nif items:\n    print("has items")\nelse:\n    print("empty")`,
        output: 'empty',
        why: 'An empty list is **falsy**. `if items` asks "is this value true-ish", not "does this variable exist". `0`, `""`, `[]`, `{}` and `None` are all falsy in Python — which is why `if x` and `if x is not None` are different questions.',
      },
      {
        title: 'Forgetting that indentation *is* the block',
        code: `if True:\n    print("inside")\nprint("outside")`,
        output: 'inside\noutside',
        why: 'Python has no braces. The four spaces decide what belongs to the `if`. Un-indent a line by accident and it leaves the block — the code still runs, it just runs always.',
      },
    ],
    check: 'Read the code out loud as a sentence: "if this is true, do that, otherwise do the other thing." If you cannot say which line runs for a given input, trace it with one concrete value rather than reasoning about it in the abstract.',
  },

  /* ------------------------------------------------------------------ loops */
  {
    id: 'loops',
    label: 'Loops',
    match: /loop|iteration|iterate|for each|while\b|repeat/i,
    what: 'A loop runs the same block of code more than once — once per item in a collection, or until a condition stops being true. It replaces copy-pasting a line twenty times.',
    why: 'Anything that has to happen "for every" something is a loop: every row in a file, every student in a list, every attempt until the password matches.',
    syntax: `for item in collection:\n    # runs once per item\n\nwhile <condition>:\n    # runs while <condition> is True`,
    examples: [
      {
        title: '`for` over a collection',
        code: `fruits = ["apple", "banana", "cherry"]\n\nfor fruit in fruits:\n    print(fruit)`,
        output: 'apple\nbanana\ncherry',
        why: 'The loop body runs once per item, and `fruit` holds that item each time. You do not track an index — Python hands you the value.',
      },
      {
        title: 'The same loop with the position, when you need it',
        code: `for index, fruit in enumerate(["apple", "banana"]):\n    print(index, fruit)`,
        output: '0 apple\n1 banana',
        why: '`enumerate` yields a pair each time. Reaching for `range(len(items))` does the same job but makes the body read as arithmetic rather than as the thing you are doing.',
      },
      {
        title: '`while` when you do not know the count in advance',
        code: `attempts = 0\n\nwhile attempts < 3:\n    attempts += 1\n    print("attempt", attempts)`,
        output: 'attempt 1\nattempt 2\nattempt 3',
        why: '`for` is for "once per item". `while` is for "until something changes" — a retry, a queue that may stay empty, a game loop. The condition is re-checked before every pass.',
      },
      {
        title: 'Accumulating a result',
        code: `total = 0\n\nfor number in [1, 2, 3, 4]:\n    total += number\n\nprint(total)`,
        output: '10',
        why: 'The accumulator starts **before** the loop and is updated inside it. Starting it inside the loop resets it every pass, which is the single most common summing bug.',
      },
    ],
    traps: [
      {
        title: 'An infinite `while`',
        code: `count = 0\n\nwhile count < 3:\n    print("stuck")   # count is never changed`,
        why: 'The condition never becomes false, so the loop never ends. Every `while` needs something inside it that moves the condition toward false — or an explicit `break`.',
      },
      {
        title: 'Changing a list while looping over it',
        code: `numbers = [1, 2, 3, 4]\n\nfor number in numbers:\n    if number % 2 == 0:\n        numbers.remove(number)\n\nprint(numbers)`,
        output: '[1, 3]',
        why: 'Here it happens to look right, but the loop is skipping items as the list shrinks under it — with `[2, 4, 6]` you would get `[4, 6]` back. Build a new list, or loop over a copy.',
      },
    ],
    check: 'For any loop, answer three things before running it: what changes each pass, what stops it, and what the value is after the last pass.',
  },

  /* ------------------------------------------------------------- variables */
  {
    id: 'variables',
    label: 'Variables and data types',
    match: /variables?|data ?types?|primitive|declaration|assignment/i,
    what: 'A variable is a name attached to a value. In Python the name is a label on an object; in Java it is a typed box that can only hold one kind of thing. That difference explains most of the errors beginners hit.',
    why: 'Every value a program works with needs to be kept somewhere and referred to later. Variables are how you say "the score" rather than "the number 42 in memory at address 0x1f".',
    syntax: `# Python — a name, no declaration, the type belongs to the value\nscore = 10\nname = "Ada"\n\n// Java — the type is declared and is part of the variable\nint score = 10;\nString name = "Ada";`,
    examples: [
      {
        title: 'Python rebinds the name; it does not change the type of a box',
        code: `x = 7\nprint(type(x).__name__)\n\nx = 7.5\nprint(type(x).__name__)`,
        output: 'int\nfloat',
        why: 'The name `x` was pointing at an `int` and is now pointing at a `float`. The integer itself was not converted — it was left behind. In Java the equivalent line would not compile.',
      },
      {
        title: 'The core types you will actually use',
        code: `count = 3            # int\nprice = 19.99        # float\ntitle = "Python"     # str\nready = True         # bool\nitems = [1, 2]       # list\npoint = (3, 4)       # tuple\nlookup = {"a": 1}    # dict\n\nprint(type(count).__name__, type(price).__name__, type(title).__name__)`,
        output: 'int float str',
        why: 'These seven cover most programs. Knowing which one you have decides what you can do next — you can append to a list but not to a tuple; you can index a list but not a number.',
      },
      {
        title: 'Converting between them',
        code: `age_text = "42"\nage = int(age_text)\n\nprint(age + 1)\nprint(age_text + "1")`,
        output: '43\n421',
        why: '`int()` converts the value, `+` on strings joins them. Reading a number from input or a file gives you a **string**, which is why `"42" + 1` would have raised instead of giving 43.',
      },
    ],
    traps: [
      {
        title: '`input()` always returns a string',
        code: `age = input("Age: ")      # the learner types 20\n\n# print(age + 1)          # TypeError: can only concatenate str\nprint(int(age) + 1)`,
        output: '21',
        why: 'The keyboard produces text, always. Convert before doing arithmetic.',
      },
      {
        title: 'Two names, one list',
        code: `a = [1, 2]\nb = a\nb.append(3)\n\nprint(a)`,
        output: '[1, 2, 3]',
        why: '`b = a` copies the *reference*, not the list. Both names point at the same object, so a change through either is visible through both. `b = a[:]` or `list(a)` copies it.',
      },
    ],
    check: 'For every variable, be able to say its type and where its value came from. Most "it does not work" bugs are a value of the wrong type arriving from somewhere unexpected.',
  },

  /* ------------------------------------------------------- functions/methods */
  {
    id: 'functions',
    label: 'Functions',
    match: /functions?|methods?|defining (functions|methods)|parameters?|arguments?|return values?/i,
    what: 'A function is a named block of code that takes inputs, does something, and optionally hands back a result. It exists so a piece of logic has one home and one name.',
    why: 'Calling a function instead of repeating its body means a fix happens in one place, and a reader sees *what* is happening rather than decoding *how* every time.',
    syntax: `def function_name(parameter, other="default"):\n    # body\n    return result`,
    examples: [
      {
        title: 'A function that returns a value',
        code: `def add(a, b):\n    return a + b\n\nresult = add(2, 3)\nprint(result)`,
        output: '5',
        why: '`return` hands the value back to the caller, who can store it or use it. The function stops the moment it returns — anything after that line in the body is skipped.',
      },
      {
        title: '`return` and `print` are not the same thing',
        code: `def show(a, b):\n    print(a + b)\n\ndef give(a, b):\n    return a + b\n\nx = show(2, 3)   # prints 5, x is None\ny = give(2, 3)   # prints nothing, y is 5\nprint(x, y)`,
        output: '5\nNone 5',
        why: '`print` writes to the screen and returns `None`. A function with no `return` also returns `None`. This is why `total = add(...)` leaves `total` as `None` when the function only printed.',
      },
      {
        title: 'Default parameters, and the order they come in',
        code: `def greet(name, greeting="Hello"):\n    return f"{greeting}, {name}"\n\nprint(greet("Ada"))\nprint(greet("Ada", "Hi"))`,
        output: 'Hello, Ada\nHi, Ada',
        why: 'Parameters with defaults must come after the ones without. A caller can also name them: `greet("Ada", greeting="Hi")`, which is clearer once there are more than two.',
      },
    ],
    traps: [
      {
        title: 'A mutable default is shared across every call',
        code: `def add_item(item, bucket=[]):\n    bucket.append(item)\n    return bucket\n\nprint(add_item("a"))\nprint(add_item("b"))`,
        output: "['a']\n['a', 'b']",
        why: 'The default `[]` is created **once**, when the function is defined, and reused for every call. Use `bucket=None` and create the list inside the body.',
      },
      {
        title: 'Losing the returned value',
        code: `def double(n):\n    return n * 2\n\ndouble(5)          # the 10 is discarded\nprint(double(5))   # 10`,
        why: 'A returned value has to be stored or used. Calling a function and ignoring what it returns is legal and silently does nothing.',
      },
    ],
    check: 'Say what the function takes, what it gives back, and whether it changes anything outside itself. If any of the three is unclear, the function is doing too much.',
  },

  /* ---------------------------------------------------------------- strings */
  {
    id: 'strings',
    label: 'Strings',
    match: /strings?|string handling|string methods|text processing/i,
    what: 'A string is an ordered sequence of characters, and in both Python and Java it is **immutable** — you never change one, you build a new one.',
    why: 'Almost every input a program receives is text: names, files, forms, JSON. Most of what you do with text is slicing, cleaning and joining.',
    syntax: `text = "Hello"\ntext[0]        # 'H'\ntext[1:3]      # 'el'\ntext.upper()   # 'HELLO'`,
    examples: [
      {
        title: 'Indexing and slicing',
        code: `word = "Python"\n\nprint(word[0])\nprint(word[-1])\nprint(word[0:3])\nprint(word[::-1])`,
        output: 'P\nn\nPyt\nnohtyP',
        why: 'Indices count from 0; negative indices count back from the end. A slice `[start:stop]` includes `start` and excludes `stop`. `[::-1]` means "step backwards", which reverses.',
      },
      {
        title: 'Cleaning and splitting input',
        code: `raw = "  Ada, Lovelace  "\n\nprint(raw.strip())\nprint(raw.strip().split(","))\nprint("-".join(["a", "b"]))`,
        output: 'Ada, Lovelace\n[\'Ada\', \' Lovelace\']\na-b',
        why: '`strip` removes surrounding whitespace, `split` cuts into a list, `join` is the inverse of `split`. Note the leading space survives in the second item — split does not tidy, it only cuts.',
      },
      {
        title: 'Building a string instead of gluing with `+`',
        code: `name = "Ada"\ncount = 3\n\nprint(f"{name} has {count} messages")`,
        output: 'Ada has 3 messages',
        why: 'An f-string inserts values and converts them for you. `name + " has " + count` would raise a `TypeError` because you cannot add a string and an int.',
      },
    ],
    traps: [
      {
        title: 'Calling a method and ignoring the result',
        code: `text = "hello"\ntext.upper()\nprint(text)`,
        output: 'hello',
        why: 'Strings cannot change, so `upper()` returns a **new** string and leaves the original alone. You need `text = text.upper()`.',
      },
    ],
    check: 'Treat every string operation as "produces a new string". If you expected the original to change, you are looking at the wrong variable.',
  },

  /* ------------------------------------------------------------------ lists */
  {
    id: 'lists',
    label: 'Lists and arrays',
    match: /lists?|arrays?|tuples?|indexing|slicing|collections?/i,
    what: 'A list is an ordered, changeable collection you index by position. A tuple is the same shape but cannot be changed. An array in Java is fixed-length and typed.',
    why: 'Any time you have "several of something" — rows, scores, names — you need a collection rather than a variable per item.',
    syntax: `items = [10, 20, 30]\nitems[0]       # 10\nitems.append(40)\nlen(items)     # 4`,
    examples: [
      {
        title: 'Adding, reading and removing',
        code: `items = ["a", "b"]\n\nitems.append("c")\nprint(items)\nprint(items[1])\nitems.remove("b")\nprint(items)`,
        output: "['a', 'b', 'c']\nb\n['a', 'c']",
        why: '`append` adds to the end, indexing reads a position, `remove` deletes by value. Note the list shrinks and everything after shifts — positions are not stable.',
      },
      {
        title: 'Looping with the index you actually need',
        code: `scores = [90, 75, 88]\n\nfor score in scores:\n    print(score)\n\nfor i, score in enumerate(scores):\n    print(i, score)`,
        output: '90\n75\n88\n0 90\n1 75\n2 88',
        why: 'Loop over the values unless you genuinely need positions. `enumerate` gives both without arithmetic in the body.',
      },
      {
        title: 'List versus tuple',
        code: `mutable = [1, 2]\nmutable.append(3)\nprint(mutable)\n\nfixed = (1, 2)\nprint(fixed[0])\n# fixed.append(3)   # AttributeError: 'tuple' object has no attribute 'append'`,
        output: '[1, 2, 3]\n1',
        why: 'A tuple signals "this is a fixed group" — coordinates, a pair of values, a returned row. It is hashable, so it can be a dictionary key; a list cannot.',
      },
    ],
    traps: [
      {
        title: 'Indexing past the end',
        code: `items = [1, 2, 3]\nprint(items[3])`,
        why: 'A three-item list has indices 0, 1 and 2. `items[len(items)]` is always one past the end — that is what `append` is for.',
      },
      {
        title: 'A 2-D list built with `*`',
        code: `grid = [[0] * 2] * 2\ngrid[0][0] = 1\nprint(grid)`,
        output: '[[1, 0], [1, 0]]',
        why: '`* 2` copies the **reference** to the same inner list, so both rows are one list. Use a comprehension: `[[0] * 2 for _ in range(2)]`.',
      },
    ],
    check: 'Know whether you need order (list), fixed structure (tuple) or lookup by key (dict) — choosing the wrong one is what makes code awkward rather than wrong.',
  },

  /* ------------------------------------------------------------ dictionaries */
  {
    id: 'dicts',
    label: 'Dictionaries',
    match: /dictionar|dicts?\b|hash ?maps?|maps?\b|sets?\b|key.?value/i,
    what: 'A dictionary stores values under keys. Lookup by key is the point: you ask for `scores["Ada"]` rather than searching a list for the entry whose name matches.',
    why: 'Whenever you have a thing identified by a name, an id or a code, a dictionary is the structure that says so directly.',
    syntax: `scores = {"Ada": 90, "Alan": 85}\nscores["Ada"]          # 90\nscores["Grace"] = 95   # add\n"Ada" in scores        # True`,
    examples: [
      {
        title: 'Reading, adding, and the `KeyError` you will hit',
        code: `scores = {"Ada": 90}\n\nprint(scores["Ada"])\nprint(scores.get("Nobody"))\nprint(scores.get("Nobody", 0))\n\n# scores["Nobody"]      # KeyError`,
        output: '90\nNone\n0',
        why: '`[]` assumes the key exists and raises when it does not. `.get` returns `None` or a default instead — use it whenever a missing key is an ordinary possibility.',
      },
      {
        title: 'Counting occurrences',
        code: `votes = ["a", "b", "a", "c", "a"]\ncounts = {}\n\nfor vote in votes:\n    counts[vote] = counts.get(vote, 0) + 1\n\nprint(counts)`,
        output: "{'a': 3, 'b': 1, 'c': 1}",
        why: 'The `get(key, 0)` is the whole idiom: "start at zero the first time you see this key". Doing `counts[vote] += 1` on a new key raises.',
      },
      {
        title: 'Iterating',
        code: `scores = {"Ada": 90, "Alan": 85}\n\nfor name in scores:\n    print(name)\n\nfor name, score in scores.items():\n    print(name, score)`,
        output: 'Ada\nAlan\nAda 90\nAlan 85',
        why: 'Looping over a dict gives keys. `.items()` gives key-and-value pairs, which is what you want when the value matters too.',
      },
    ],
    traps: [
      {
        title: 'Assuming order means something',
        code: `d = {"b": 1, "a": 2}`,
        why: 'Modern Python preserves insertion order, but a dictionary is still not a sorted structure and is not *for* order. If order matters, sort explicitly: `sorted(d.items())`.',
      },
      {
        title: 'A list as a key',
        code: `d = {}\n# d[[1, 2]] = "x"    # TypeError: unhashable type: 'list'\nd[(1, 2)] = "x"      # a tuple is fine`,
        why: 'Keys must be hashable, meaning immutable. A list can change, so it cannot have a stable hash.',
      },
    ],
    check: 'For any lookup, ask what happens when the key is missing. If the answer is "crash", decide whether that is what you meant.',
  },

  /* -------------------------------------------------------------- functions+ */
  {
    id: 'classes',
    label: 'Classes and objects',
    match: /classes?|objects?|instances?|oop|object.?oriented/i,
    what: 'A class bundles data with the behaviour that belongs to it. An object is one instance of that class, holding its own copy of the data.',
    why: 'Once a program has several things of the same kind — users, orders, shapes — keeping each one\'s data and functions together stops the passing-around of six separate variables.',
    syntax: `class Name:\n    def __init__(self, value):\n        self.value = value\n\n    def method(self):\n        return self.value`,
    examples: [
      {
        title: 'A class with state and behaviour',
        code: `class Counter:\n    def __init__(self):\n        self.count = 0\n\n    def increment(self):\n        self.count += 1\n\nc = Counter()\nc.increment()\nc.increment()\nprint(c.count)`,
        output: '2',
        why: '`__init__` sets up each new object. `self` is that particular object, which is why two counters keep separate counts.',
      },
      {
        title: 'Two instances do not share data',
        code: `a = Counter()\nb = Counter()\na.increment()\n\nprint(a.count, b.count)`,
        output: '1 0',
        why: '`self.count` is per-object. Storing it on the class instead (`count = 0` up top) would give every instance the same value — the mutable-default trap in another costume.',
      },
      {
        title: 'Inheritance in one line',
        code: `class Cat: \n    def speak(self):\n        return "meow"\n\nclass Kitten(Cat):\n    pass\n\nprint(Kitten().speak())`,
        output: 'meow',
        why: '`Kitten` inherits `speak`. Override it by defining `speak` again in `Kitten`; call the parent version with `super().speak()`.',
      },
    ],
    traps: [
      {
        title: 'Mutable class-level state',
        code: `class Team:\n    members = []      # shared by every instance\n\n    def add(self, name):\n        self.members.append(name)\n\nTeam().add("Ada")\nprint(Team().members)`,
        output: "['Ada']",
        why: 'The list lives on the class, not the instance. Create it in `__init__`.',
      },
      {
        title: 'Forgetting `self`',
        code: `class A:\n    def __init__(self):\n        self.x = 1\n\n    def get(self):\n        return x      # NameError — needs self.x`,
        why: 'Inside a method, a bare name looks in the local scope, then module scope. Instance data is always reached through `self`.',
      },
    ],
    check: 'For each class, name the data each object owns and the operations that data must keep consistent. If a method touches nothing on `self`, it probably should not be a method.',
  },

  /* -------------------------------------------------------------- recursion */
  {
    id: 'recursion',
    label: 'Recursion',
    match: /recursi|backtracking|divide and conquer/i,
    what: 'Recursion is a function that calls itself on a smaller version of the same problem. Every recursion needs two things: a **base case** that stops it, and a **recursive step** that makes the problem smaller.',
    why: 'Some problems are defined in terms of themselves — a folder contains folders, a tree contains subtrees, factorial(n) is n times factorial(n-1). Writing the solution the way the problem is defined is often far shorter than simulating it with a loop.',
    syntax: `def solve(problem):
    if <problem is small enough>:      # base case
        return <the answer directly>
    return <combine>(solve(<smaller problem>))`,
    examples: [
      {
        title: 'Factorial — the canonical shape',
        code: `def factorial(n):
    if n <= 1:            # base case
        return 1
    return n * factorial(n - 1)   # smaller by one each call

print(factorial(4))`,
        output: '24',
        why: '`factorial(4)` becomes `4 * factorial(3)` → `4 * 3 * factorial(2)` → … → `4 * 3 * 2 * 1`. The calls pile up and then unwind, multiplying on the way back out.',
      },
      {
        title: 'Why the base case is not optional',
        code: `def countdown(n):
    print(n)
    if n == 0:
        return
    countdown(n - 1)

countdown(3)`,
        output: '3\\n2\\n1\\n0',
        why: 'Without the `if n == 0: return`, the function would call itself with -1, then -2, forever — until Python raises `RecursionError: maximum recursion depth exceeded`.',
      },
      {
        title: 'Walking a structure that contains itself',
        code: `def total(numbers):
    if not numbers:        # empty list: nothing to add
        return 0
    return numbers[0] + total(numbers[1:])

print(total([1, 2, 3]))`,
        output: '6',
        why: 'The list shrinks by one each call, so the base case (`[]`) is guaranteed to arrive. This is the shape for trees and nested structures, where a loop cannot express the depth.',
      },
    ],
    traps: [
      {
        title: 'Recursing without shrinking the problem',
        code: `def bad(n):
    return bad(n)    # RecursionError`,
        why: 'If the argument never gets closer to the base case, the function calls itself until memory runs out. Every recursive call must move strictly toward the base case.',
      },
      {
        title: 'Deep recursion overflows the stack',
        code: `def count(n):
    return 0 if n == 0 else 1 + count(n - 1)

print(count(5000))   # RecursionError: maximum recursion depth exceeded`,
        why: 'Python allows about 1000 nested calls by default. For a long, thin problem like this, a loop uses constant memory and cannot overflow.',
      },
    ],
    check: 'For any recursive function, answer three things: what the base case returns, how each call gets smaller, and what the combination step does with the result. If you cannot name the base case, the function will not stop.',
  },

  /* ------------------------------------------------- searching and sorting */
  {
    id: 'searching',
    label: 'Searching and sorting',
    match: /search|sort|sorting|binary search|linear search|merge sort|quick ?sort/i,
    what: 'Searching finds an item in a collection. Sorting puts a collection in order. They are paired because sorting is what makes fast searching possible.',
    why: 'Finding one record among ten thousand by checking each in turn is slow; doing it on sorted data in a dozen steps is not. This is the clearest example of how the shape of the data decides the cost of the algorithm.',
    syntax: `for item in items:            # linear search — O(n)
    if item == target: ...

# binary search needs sorted data — O(log n)
low, high = 0, len(items) - 1\nwhile low <= high:
    mid = (low + high) // 2
    if items[mid] == target: ...
    elif items[mid] < target: low = mid + 1
    else: high = mid - 1`,
    examples: [
      {
        title: 'Linear search — correct, and slow for a reason',
        code: `def find(items, target):
    for index, item in enumerate(items):
        if item == target:
            return index
    return -1

print(find(["a", "b", "c"], "c"))
print(find(["a", "b", "c"], "z"))`,
        output: '2\\n-1',
        why: 'It checks every item until it finds one, so on an unsorted list of `n` items it may do `n` comparisons. Returning `-1` rather than `None` makes "not found" an explicit result.',
      },
      {
        title: 'Binary search — halving the range each step',
        code: `def binary_search(items, target):
    low, high = 0, len(items) - 1
    while low <= high:
        mid = (low + high) // 2
        if items[mid] == target:
            return mid
        if items[mid] < target:
            low = mid + 1
        else:
            high = mid - 1
    return -1

print(binary_search([1, 3, 5, 7, 9, 11], 7))`,
        output: '3',
        why: 'Each comparison discards half the remaining range, so 1000 items take about 10 steps instead of 1000. It only works because the list is sorted — on an unsorted list it returns nonsense.',
      },
      {
        title: 'Sorting with the built-in, and the key that decides order',
        code: `people = [("Ada", 36), ("Alan", 41), ("Grace", 45)]

print(sorted(people, key=lambda p: p[1]))
print(sorted(people, key=lambda p: p[1], reverse=True))`,
        output: "[('Ada', 36), ('Alan', 41), ('Grace', 45)]\\n[('Grace', 45), ('Alan', 41), ('Ada', 36)]",
        why: '`sorted` returns a new list; `key` says what to compare. Without a key, tuples are compared element by element — the name first, which is rarely what you meant.',
      },
    ],
    traps: [
      {
        title: 'Binary search on unsorted data',
        code: `print(binary_search([9, 3, 7, 1], 7))   # -1, though 7 is present`,
        why: 'Binary search assumes the order it is discarding by. On unsorted input it can discard the half that contained the target and report "not found" for an item that is there.',
      },
      {
        title: 'Off-by-one in the bounds',
        code: `while low < high:        # misses the last element when low == high`,
        why: 'The loop must still run when the range has collapsed to a single element, which is why the condition is `low <= high`. This is the classic bug in hand-written binary search.',
      },
    ],
    check: 'Ask what the data is sorted by and whether that is still true. Most "search is broken" bugs are actually "the data stopped being sorted".',
  },

  /* ------------------------------------------------------- stacks & queues */
  {
    id: 'stacks',
    label: 'Stacks and queues',
    match: /stack|queue|deque|heap|priority queue|linked list/i,
    what: 'A stack adds and removes at the same end — last in, first out. A queue adds at one end and removes at the other — first in, first out. Both are lists with a *rule* about how you are allowed to touch them.',
    why: 'The rule is the point. Undo history, browser back, and function calls are stacks. Print jobs, message buffers and breadth-first search are queues. Choosing the right one is what makes the algorithm natural.',
    syntax: `stack = []\nstack.append(x)     # push
stack.pop()         # pop the last one

from collections import deque
queue = deque()\nqueue.append(x)     # enqueue at the back
queue.popleft()     # dequeue from the front`,
    examples: [
      {
        title: 'A stack reverses what you put in',
        code: `stack = []
for letter in ["a", "b", "c"]:
    stack.append(letter)

while stack:
    print(stack.pop())`,
        output: 'c\\nb\\na',
        why: 'The last item pushed is the first popped. This is exactly why undo works: the most recent action is the first one undone.',
      },
      {
        title: 'A queue preserves order',
        code: `from collections import deque

queue = deque(["a", "b", "c"])
print(queue.popleft())
print(queue.popleft())`,
        output: 'a\\nb',
        why: 'Items leave in the order they arrived. Using `pop()` here instead would make it a stack — the same container, a different rule.',
      },
      {
        title: 'Checking the brackets problem',
        code: `def balanced(text):
    stack = []
    pairs = {")": "(", "]": "["}
    for char in text:
        if char in "([":
            stack.append(char)
        elif char in pairs:
            if not stack or stack.pop() != pairs[char]:
                return False
    return not stack

print(balanced("([])"))
print(balanced("([)]"))`,
        output: 'True\\nFalse',
        why: 'Each closing bracket must match the most recently opened one — which is exactly LIFO. `([)]` fails because the `)` meets a `[` on top of the stack.',
      },
    ],
    traps: [
      {
        title: 'Using a list as a queue',
        code: `queue = [1, 2, 3]
queue.pop(0)     # works, but shifts every remaining item`,
        why: '`pop(0)` moves every other element down one, so draining a list of `n` items costs `n²`. `deque.popleft()` is O(1) — this is the difference between code that scales and code that hangs.',
      },
      {
        title: 'Popping an empty stack',
        code: `stack = []
print(stack.pop())   # IndexError: pop from empty list`,
        why: 'Check `if stack:` first, or use the emptiness of the list as the loop condition — as the reversal example does with `while stack:`.',
      },
    ],
    check: 'Say out loud which end you add to and which end you remove from. If they are the same end it is a stack; if they are opposite ends it is a queue.',
  },

  /* ------------------------------------------------------------ inheritance */
  {
    id: 'inheritance',
    label: 'Inheritance',
    match: /inherit|subclass|superclass|extends|polymorphism|overrid/i,
    what: 'Inheritance lets one class build on another: the child gets the parent\'s data and methods, and adds or replaces what it needs. `super()` reaches the parent\'s version.',
    why: 'Two classes that share most of their behaviour and differ in one method should share the code, not duplicate it. Inheritance is the mechanism for "is a kind of".',
    syntax: `class Parent:\n    def method(self):\n        return "parent"\n\nclass Child(Parent):\n    def method(self):\n        return super().method() + " + child"`,
    examples: [
      {
        title: 'Inheriting without changing anything',
        code: `class Animal:\n    def eat(self):\n        return "eating"\n\nclass Dog(Animal):\n    pass\n\nprint(Dog().eat())`,
        output: 'eating',
        why: '`Dog` declares no methods at all, yet has `eat` from `Animal`. Everything the parent can do, the child can do.',
      },
      {
        title: 'Overriding one method and keeping the rest',
        code: `class Animal:\n    def speak(self):\n        return "..."\n\n    def describe(self):\n        return f"This animal says {self.speak()}"\n\nclass Dog(Animal):\n    def speak(self):\n        return "woof"\n\nprint(Dog().describe())`,
        output: 'This animal says woof',
        why: '`describe` is written once, in the parent, and calls `self.speak()`. The child\'s `speak` is what gets called — that is polymorphism, and it is why the parent can be written before any child exists.',
      },
      {
        title: 'Extending the parent with `super()`',
        code: `class Animal:\n    def __init__(self, name):\n        self.name = name\n\nclass Dog(Animal):\n    def __init__(self, name):\n        super().__init__(name)\n        self.tricks = []\n\nprint(Dog("Rex").name)`,
        output: 'Rex',
        why: 'Without `super().__init__(name)` the parent never sets `name` and it is missing. Call it first, then add the child\'s own setup.',
      },
    ],
    traps: [
      {
        title: 'Forgetting to call the parent constructor',
        code: `class Animal:\n    def __init__(self, name):\n        self.name = name\n\nclass Dog(Animal):\n    def __init__(self):\n        self.tricks = []\n\n# Dog("Rex")   # TypeError: takes 1 argument but 2 were given`,
        why: 'The child defined its own `__init__`, so the parent\'s is not used. Either accept and forward the arguments, or call `super().__init__(...)`.',
      },
      {
        title: 'Inheriting for the wrong reason',
        code: `class Stack(list):\n    pass`,
        why: 'A stack "has a" list, it is not a kind of list — inheritance exposes `insert`, `pop(0)` and everything else, so the stack can be corrupted through the parent\'s interface. Hold the list as an attribute instead.',
      },
    ],
    check: 'Say the relationship out loud: "Child **is a** Parent." If the honest sentence is "Child **has a** Parent", use composition instead.',
  },

  /* -------------------------------------------------------------- operators */
  {
    id: 'operators',
    label: 'Operators',
    match: /operators?|expressions?|arithmetic|comparison|logical operators?/i,
    what: 'Operators combine values: arithmetic (`+ - * /`), comparison (`== != < >`) and logic (`and or not`). Their precedence decides what happens first.',
    why: 'Almost every bug that is not a type error is an expression evaluated in the order you did not intend.',
    syntax: `a + b        # arithmetic\n a == b      # comparison -> bool\n a and b     # logic (short-circuits)`,
    examples: [
      {
        title: 'Integer versus float division',
        code: `print(7 / 2)\nprint(7 // 2)\nprint(7 % 2)`,
        output: '3.5\n3\n1',
        why: '`/` always gives a float, `//` floors to an integer, `%` gives the remainder. In Java `7 / 2` on two ints is `3` — the same characters, a different answer.',
      },
      {
        title: 'Comparison chaining',
        code: `x = 5\nprint(1 < x < 10)\nprint(x == 5 and x < 10)`,
        output: 'True\nTrue',
        why: 'Python allows the maths-style chain, which reads like the condition you mean. `and` short-circuits — the right side is not evaluated if the left is already False.',
      },
    ],
    traps: [
      {
        title: 'Integer division where you needed a fraction',
        code: `average = 7 // 2\nprint(average)`,
        output: '3',
        why: 'Floor division truncates. Averages almost always want `/`, and in Java they want a cast: `(double) total / count`.',
      },
      {
        title: 'Floating-point equality',
        code: `print(0.1 + 0.2 == 0.3)\nprint(abs((0.1 + 0.2) - 0.3) < 1e-9)`,
        output: 'False\nTrue',
        why: '`0.1` cannot be stored exactly in binary, so the sum is `0.30000000000000004`. Compare floats with a tolerance, never with `==`.',
      },
    ],
    check: 'When an expression surprises you, add brackets until it is obvious, then check whether you assumed decimal arithmetic where the machine used binary.',
  },

  /* --------------------------------------------------------------- exceptions */
  {
    id: 'errors',
    label: 'Errors and exceptions',
    match: /exception|error handling|try.?catch|try.?except|debugging/i,
    what: 'An exception is how a program reports that something went wrong. Handling one means deciding what to do about it instead of letting it stop the program.',
    why: 'Files are missing, input is malformed, networks drop. Every one of those is ordinary, and the place that knows what to do about it is not usually the place that hit it.',
    syntax: `try:\n    risky()\nexcept ValueError as error:\n    handle(error)\nfinally:\n    clean_up()`,
    examples: [
      {
        title: 'Catching a specific failure',
        code: `def to_number(text):\n    try:\n        return int(text)\n    except ValueError:\n        return None\n\nprint(to_number("42"))\nprint(to_number("abc"))`,
        output: '42\nNone',
        why: 'Catch the error you expect, at the place that can do something about it. Catching `ValueError` says "bad input is possible here".',
      },
      {
        title: 'The difference between a crash and a silent wrong answer',
        code: `items = [1, 2, 3]\n\ntry:\n    print(items[5])\nexcept IndexError as error:\n    print("no item 5:", error)`,
        output: 'no item 5: list index out of range',
        why: 'The error message names the problem. An `except` that ignores it and continues leaves you with a wrong answer and no clue why.',
      },
    ],
    traps: [
      {
        title: 'A bare `except` swallows everything',
        code: `try:\n    value = compute()\nexcept:\n    value = 0`,
        why: 'This catches `KeyboardInterrupt` and your own typos alike, so a broken program looks like a working one producing zeros. Catch the specific type, and re-raise what you cannot handle.',
      },
    ],
    check: 'For each `except`, say which error you expect and what the program now does instead. "Nothing" is a legitimate answer only if you meant it.',
  },

  /* ------------------------------------------------------------------ input */
  {
    id: 'io',
    label: 'Input and output',
    match: /input|output|print|reading|writing|files?|file (io|handling)/i,
    what: 'Input is data coming in — from the keyboard, a file, a request. Output is data going out. `input()` gives you text; `print()` writes text.',
    why: 'A program that cannot take input or show results is a calculation nobody can use.',
    syntax: `name = input("Name: ")\nprint(f"Hello {name}")\n\nwith open("data.txt") as f:\n    for line in f: ...`,
    examples: [
      {
        title: 'Input is always a string',
        code: `age = input("Age: ")     # types 20\nprint(type(age).__name__)\nprint(int(age) + 1)`,
        output: 'str\n21',
        why: 'Whatever is typed arrives as text. Convert before arithmetic.',
      },
      {
        title: 'Reading a file without leaking the handle',
        code: `# names.txt holds: Ada / Alan / Grace, one per line\nwith open("names.txt") as handle:\n    for line in handle:\n        print(line.strip())`,
        output: 'Ada\nAlan\nGrace',
        why: '`with` closes the file even if the loop raises. `line.strip()` removes the newline every line carries — without it every printed line is followed by a blank one.',
      },
    ],
    traps: [
      {
        title: 'Forgetting to close, or to strip',
        code: `f = open("names.txt")\ndata = f.read()\n# f.close()   # missing`,
        why: 'An unclosed file can stay locked, and buffered writes may never reach disk. `with` is shorter *and* correct.',
      },
    ],
    check: 'Know the type of everything you read before you use it, and whether it still has a trailing newline.',
  },
];

/** Find the tutorial for a concept, by title first and prose second. */
export function findTutorial(title, ...extra) {
  const haystack = [String(title || ''), ...extra.map((e) => String(e || ''))].join(' ');
  if (!haystack.trim()) return null;
  return TUTORIALS.find((entry) => entry.match.test(haystack)) || null;
}

/** The language a tutorial's examples should be shown in. */
export function tutorialLanguage(text) {
  const lower = String(text || '').toLowerCase();
  if (/\bjava\b(?!script)/.test(lower)) return 'java';
  return 'python';
}

export { python, java };
