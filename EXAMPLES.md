# Examples

Open this file in metascope to review styles:

`metascope EXAMPLES.md`

---

# Heading level 1

Background brightness marks the level — no `#` characters in the view.

## Heading level 2

### Heading level 3

#### Heading level 4

##### Heading level 5

###### Heading level 6

Inline styles: **bold**, _italic_, `inline code`, `Array`, `Object`, and a [link](https://metarhia.com).

---

## Quotes

> Soft background block with inner padding. Consecutive quote lines merge into one band. Left rule `│` marks the quote edge.

---

## Lists

- Unordered item one
- Unordered item two
  - Nested item
- Item with `code` and **bold**

1. First ordered
2. Second ordered
3. Third ordered

---

## Tables

| Left        | Center | Right |
| :---------- | :----: | ----: |
| a           |  mid   |     1 |
| longer text |   x    |    42 |

---

## JavaScript

Mark a shared preamble with `js init` — it is prepended to every `js` / `mjs` / `ts` run. Click **▶** on example fences to execute; stdout/stderr appear under the block.

```js init
'use strict';

// Shared imports / helpers for examples below
const assert = require('node:assert');
const DEMO_NAME = 'Metarhia';
```

```js
const greet = async (name) => {
  // soft block bg, syntax only — no language label
  const re = /^[A-Z]/i;
  if (!re.test(name)) throw new Error('bad name');
  return `Hello, ${name}!`;
};

greet(DEMO_NAME).then((msg) => {
  console.log(msg);
  assert.ok(msg.includes(DEMO_NAME));
});
```

## TypeScript

```ts
export interface User {
  id: number;
  name: string;
}

export type Id = string | number;

const greet = (u: User): string => `Hi ${u.name}`;
```

## JSON

```json
{
  "name": "metascope",
  "ok": true,
  "count": 42,
  "tags": ["cli", "md", "metarhia"]
}
```

## CSS

```css
/* theme tokens */
.header {
  color: #0af;
  font-size: 14px;
}

@media screen {
  .header {
    display: flex;
  }
}
```

## HTML

```html
<!doctype html>
<html>
  <body class="main">
    <!-- note -->
    <h1 id="t">Title</h1>
    <a href="/x">link</a>
  </body>
</html>
```

## CSV

```csv
name,age,city
Ada,36,London
Bob,41,Berlin
Eve,29,Kyiv
```

## Plain / unknown fence

```bash
# treated as plain text highlight
echo "hello metascope"
curl -s https://metarhia.com
```

```txt
Plain text with a URL https://metarhia.com and www.example.com
```
