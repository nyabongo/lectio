/**
 * A small regex-to-string generator for JSON Schema `pattern` values: enough for the
 * patterns Lectio schemas use (anchors, literals, escapes such as `\d` `\S` `\.`,
 * character classes with ranges and negation, `.`, groups, `(?:…)`, alternation and
 * the quantifiers `? * + {n} {n,} {n,m}`). Lookarounds, backreferences and other
 * constructs throw {@link PatternError}.
 *
 * The result matches the pattern by construction: optional parts are included once,
 * repeated parts appear their minimum number of times (at least once when allowed),
 * alternations take their first option and character classes yield a seeded pick,
 * preferring lower-case letters, then digits, then upper-case letters.
 */

export class PatternError extends Error {
  override readonly name: string = 'PatternError';
}

/** Characters a class may yield, in order of preference. */
const POOLS = [
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ' -_.,:;!?\'"()/@#$%&*+=<>[]{}|~^`\\\t\n',
];

type CharTest = (char: string) => boolean;

interface Quantified {
  readonly atom: CharTest | Alternation;
  readonly min: number;
  readonly max: number;
}

type Sequence = Quantified[];
type Alternation = Sequence[];

const DIGIT: CharTest = (c) => c >= '0' && c <= '9';
const WORD: CharTest = (c) => /[A-Za-z0-9_]/.test(c);
const SPACE: CharTest = (c) => /\s/.test(c);

class Parser {
  #pos = 0;
  readonly #src: string;

  constructor(src: string) {
    this.#src = src;
  }

  parse(): Alternation {
    const alternation = this.#alternation();
    if (this.#pos < this.#src.length) this.#fail(`unexpected "${this.#src[this.#pos] as string}"`);
    return alternation;
  }

  #fail(message: string): never {
    throw new PatternError(`unsupported pattern /${this.#src}/ at ${this.#pos}: ${message}`);
  }

  #peek(): string | undefined {
    return this.#src[this.#pos];
  }

  #next(): string {
    const char = this.#src[this.#pos];
    if (char === undefined) this.#fail('unexpected end');
    this.#pos += 1;
    return char;
  }

  #alternation(): Alternation {
    const options: Alternation = [this.#sequence()];
    while (this.#peek() === '|') {
      this.#pos += 1;
      options.push(this.#sequence());
    }
    return options;
  }

  #sequence(): Sequence {
    const items: Sequence = [];
    for (let char = this.#peek(); char !== undefined && char !== '|' && char !== ')'; char = this.#peek()) {
      if (char === '^' || char === '$') {
        this.#pos += 1;
        continue;
      }
      const atom = this.#atom();
      items.push({ atom, ...this.#quantifier() });
    }
    return items;
  }

  #atom(): CharTest | Alternation {
    const char = this.#next();
    if (char === '(') {
      if (this.#peek() === '?') {
        this.#pos += 1;
        if (this.#next() !== ':') this.#fail('lookarounds and named groups are not supported');
      }
      const inner = this.#alternation();
      this.#next(); // the alternation stops only at ")" or the end, which throws
      return inner;
    }
    if (char === '[') return this.#charClass();
    if (char === '.') return (c) => c !== '\n';
    if ('*+?{'.includes(char)) this.#fail(`nothing to repeat before "${char}"`);
    const literal = char === '\\' ? this.#escape(this.#next()) : char;
    return typeof literal === 'string' ? (c) => c === literal : literal;
  }

  /** The meaning of `\\<char>`: a class test, or the literal character it stands for. */
  #escape(char: string): string | CharTest {
    switch (char) {
      case 'd':
        return DIGIT;
      case 'D':
        return (c) => !DIGIT(c);
      case 'w':
        return WORD;
      case 'W':
        return (c) => !WORD(c);
      case 's':
        return SPACE;
      case 'S':
        return (c) => !SPACE(c);
      case 'n':
        return '\n';
      case 't':
        return '\t';
      default:
        if (/[A-Za-z0-9]/.test(char)) this.#fail(`escape "\\${char}" is not supported`);
        return char;
    }
  }

  #classChar(): string | CharTest {
    const char = this.#next();
    return char === '\\' ? this.#escape(this.#next()) : char;
  }

  #charClass(): CharTest {
    const negated = this.#peek() === '^';
    if (negated) this.#pos += 1;
    const tests: CharTest[] = [];
    while (this.#peek() !== ']') {
      const start = this.#classChar();
      if (typeof start !== 'string') {
        tests.push(start);
        continue;
      }
      if (this.#peek() === '-' && this.#src[this.#pos + 1] !== ']') {
        this.#pos += 1;
        const end = this.#classChar();
        if (typeof end !== 'string' || end < start) this.#fail('invalid range');
        tests.push((c) => c >= start && c <= end);
      } else {
        tests.push((c) => c === start);
      }
    }
    this.#pos += 1;
    const inClass: CharTest = (c) => tests.some((test) => test(c));
    return negated ? (c) => !inClass(c) : inClass;
  }

  #quantifier(): { min: number; max: number } {
    const char = this.#peek();
    let range: { min: number; max: number };
    if (char === '?') range = { min: 0, max: 1 };
    else if (char === '*') range = { min: 0, max: Infinity };
    else if (char === '+') range = { min: 1, max: Infinity };
    else if (char === '{') {
      const match = /^\{(\d+)(,(\d*))?\}/.exec(this.#src.slice(this.#pos));
      if (!match) this.#fail('invalid "{" quantifier');
      const min = Number(match[1]);
      const max = match[2] === undefined ? min : match[3] ? Number(match[3]) : Infinity;
      this.#pos += match[0].length - 1;
      range = { min, max };
    } else return { min: 1, max: 1 };
    this.#pos += 1;
    if (this.#peek() === '?') this.#pos += 1; // lazy marker: same strings
    return range;
  }
}

/** A string that matches `pattern`, chosen deterministically from `random`. */
export function generateFromPattern(pattern: string, random: () => number): string {
  const tree = new Parser(pattern).parse();
  const pick = (test: CharTest): string => {
    for (const pool of POOLS) {
      const allowed = [...pool].filter(test);
      if (allowed.length > 0) return allowed[Math.floor(random() * allowed.length)] as string;
    }
    throw new PatternError(`unsupported pattern /${pattern}/: a character class matches no printable ASCII`);
  };
  const emit = (alternation: Alternation): string =>
    (alternation[0] as Sequence)
      .map(({ atom, min, max }) => {
        const count = min > 0 ? min : Math.min(max, 1);
        return Array.from({ length: count }, () => (typeof atom === 'function' ? pick(atom) : emit(atom))).join('');
      })
      .join('');
  return emit(tree);
}
