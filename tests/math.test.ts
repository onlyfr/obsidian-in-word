import { describe, expect, it } from "vitest";
import { latexToOmml, ommlToLatex, ommlSignature } from "../src/convert/math";

const r = String.raw;

/** [input LaTeX, canonical LaTeX after a round trip through OMML] */
const CORPUS: [string, string][] = [
  [r`x`, r`x`],
  [r`a+b=c`, r`a+b=c`],
  [r`\frac{a}{b}`, r`\frac{a}{b}`],
  [r`\frac{1}{2}+\frac{x+1}{y^2}`, r`\frac{1}{2}+\frac{x+1}{y^2}`],
  [r`x^2`, r`x^2`],
  [r`x_i`, r`x_i`],
  [r`x_i^2`, r`x_i^2`],
  [r`x^{2}_{ij}`, r`x_{ij}^2`],
  [r`e^{x^2}`, r`e^{x^2}`],
  [r`a_{n_k}`, r`a_{n_k}`],
  [r`x^{a_b^c}`, r`x^{a_b^c}`],
  [r`\alpha+\beta\gamma`, r`\alpha+\beta\gamma`],
  [r`\Gamma\Delta\Omega`, r`\Gamma\Delta\Omega`],
  [r`\sum_{i=1}^{n} i^2`, r`\sum_{i=1}^n{i^2}`],
  [r`\sum_{i=1}^n a_i`, r`\sum_{i=1}^n{a_i}`],
  [r`\prod_{k=0}^{m}{x_k}`, r`\prod_{k=0}^m{x_k}`],
  [r`\int_0^1 f(x)dx`, r`\int_0^1{f}(x)dx`],
  [r`\int_{-\infty}^{\infty}{e^{-x^2}}dx`, r`\int_{-\infty}^\infty{e^{-x^2}}dx`],
  [r`\oint_C F`, r`\oint_C{F}`],
  [r`\sum\limits_{i}{x}`, r`\sum_i{x}`],
  [r`\sqrt{x}`, r`\sqrt{x}`],
  [r`\sqrt[3]{x+1}`, r`\sqrt[3]{x+1}`],
  [r`\sqrt[n]{\frac{a}{b}}`, r`\sqrt[n]{\frac{a}{b}}`],
  [r`\left(\frac{a}{b}\right)`, r`\left( \frac{a}{b} \right)`],
  [r`\left[ x \right]`, r`\left[ x \right]`],
  [r`\left\{ x \right.`, r`\left\{ x \right.`],
  [r`\left| x \right|`, r`\left| x \right|`],
  [r`\left\langle a \middle| b \right\rangle`, r`\left\langle a \middle| b \right\rangle`],
  [r`\binom{n}{k}`, r`\binom{n}{k}`],
  [r`\begin{matrix} a & b \\ c & d \end{matrix}`, r`\begin{matrix} a & b \\ c & d \end{matrix}`],
  [r`\begin{pmatrix} 1 & 0 \\ 0 & 1 \end{pmatrix}`, r`\begin{pmatrix} 1 & 0 \\ 0 & 1 \end{pmatrix}`],
  [r`\begin{bmatrix} a & b \\ c & d \end{bmatrix}`, r`\begin{bmatrix} a & b \\ c & d \end{bmatrix}`],
  [r`\begin{vmatrix} a & b \\ c & d \end{vmatrix}`, r`\begin{vmatrix} a & b \\ c & d \end{vmatrix}`],
  [r`\begin{cases} x & x>0 \\ -x & x\le 0 \end{cases}`, r`\begin{cases} x&x>0 \\ -x&x\leq 0 \end{cases}`],
  [r`\hat{x}+\vec{v}+\bar{y}+\dot{z}+\tilde{w}`, r`\hat{x}+\vec{v}+\bar{y}+\dot{z}+\tilde{w}`],
  [r`\overline{AB}`, r`\overline{AB}`],
  [r`\underline{x}`, r`\underline{x}`],
  [r`\sin x+\cos y`, r`\sin x+\cos y`],
  [r`\sin^2 x`, r`\sin^2 x`],
  [r`\sin{x+y}`, r`\sin{x+y}`],
  [r`\ln\left(x\right)`, r`\ln \left( x \right)`],
  [r`\lim_{x\to 0} \frac{\sin x}{x}`, r`\lim_{x\to 0}{\frac{\sin x}{x}}`],
  [r`\max_{i} x_i`, r`\max_i{x_i}`],
  [r`\operatorname{rank} A`, r`\operatorname{rank} A`],
  [r`\text{if } x>0`, r`\text{if }x>0`],
  [r`x\text{ and }y`, r`x\text{ and }y`],
  [r`\mathrm{d}x`, r`\mathrm{d}x`],
  [r`\mathbf{A}\mathbb{R}`, r`\mathbf{A}\mathbb{R}`],
  [r`a\times b\cdot c\pm d`, r`a\times b\cdot c\pm d`],
  [r`a \leq b \geq c \neq d \approx e`, r`a\leq b\geq c\neq d\approx e`],
  [r`x \in A \cup B \subset C`, r`x\in A\cup B\subset C`],
  [r`\infty\partial\nabla`, r`\infty\partial\nabla`],
  [r`f'(x)`, r`f'(x)`],
  [r`\{a,b\}`, r`\{a,b\}`],
  [r`a\,b\;c\quad d`, r`a\,b\;c\quad d`],
  [r`{}_{1}^{2}X`, r`{}_1^2{X}`],
  [r`\begin{aligned} a &= b \\ c &= d \end{aligned}`, r`\begin{aligned} a&=b \\ c&=d \end{aligned}`],
  [r`\frac{-b\pm\sqrt{b^2-4ac}}{2a}`, r`\frac{-b\pm\sqrt{b^2-4ac}}{2a}`],
  [
    r`\sum_{k=1}^{n}\left(\frac{x_k}{\sqrt[3]{k}}\right)^{2}`,
    r`\sum_{k=1}^n{\left( \frac{x_k}{\sqrt[3]{k}} \right)^2}`,
  ],
  [r`\overbrace{a+b}`, r`\overbrace{a+b}`],
  [r`\underset{a}{b}`, r`\underset{a}{b}`],
];

describe("LaTeX <-> OMML corpus", () => {
  for (const [input, canonical] of CORPUS) {
    it(input, () => {
      const omml = latexToOmml(input);
      expect(omml, "latex -> omml").not.toBeNull();
      const back = ommlToLatex(omml!);
      expect(back, "omml -> latex").not.toBeNull();
      expect(back!.display).toBe(false);
      expect(back!.latex).toBe(canonical);
      // the canonical form means the same thing: it converts to a structurally identical equation
      expect(ommlSignature(latexToOmml(back!.latex)!)).toBe(ommlSignature(omml!));
    });
  }
});
