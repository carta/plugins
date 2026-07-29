/* deck-stage.js — custom element that sizes each child <section> to 1920×1080 */
class DeckStage extends HTMLElement {
  connectedCallback() {
    const W = 1920;
    const H = 1080;
    this.style.display = 'block';
    this.style.width = W + 'px';
    this.style.overflow = 'hidden';
    for (const s of this.querySelectorAll(':scope > section')) {
      s.style.width = W + 'px';
      s.style.height = H + 'px';
      s.style.overflow = 'hidden';
      s.style.position = 'relative';
      s.style.boxSizing = 'border-box';
    }
  }
}
customElements.define('deck-stage', DeckStage);
