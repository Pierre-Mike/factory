# Credits

This skill is written for factory projects. It adapts ideas from three MIT-licensed skill
libraries and doesn't depend on any of them at runtime:

- [mattpocock/skills](https://github.com/mattpocock/skills), `skills/engineering/code-review`:
  separate review axes run in parallel and reported side by side without reranking, the early
  check of the base and the diff, and smells reported as labelled judgment calls. Copyright (c)
  2026 Matt Pocock.
- [backnotprop/pstack](https://github.com/backnotprop/pstack), `skills/interrogate` (its lead
  judgment and reviewer prompt references): the filters applied to findings, the finding format,
  the cap of about five actions, the dismissed list, and "no findings" as a valid result.
  `skills/blast-radius`: the one fact a change is safe because of, and how far it was proven.
  Copyright (c) 2026 Lauren Tan.
- [garrytan/gstack](https://github.com/garrytan/gstack), `review/gate-integrity.md`: the gate
  integrity question and the kinds of gate weakening to look for. Ideas only, no text copied.
  Copyright (c) 2026 Garry Tan.

All three libraries are distributed under the MIT License:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
> BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
