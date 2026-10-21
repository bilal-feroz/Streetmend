/** Width the floating planning panel covers on the right of the map (0 on small screens). */
export function panelInset(): number {
  const el = document.querySelector<HTMLElement>('[data-floating-panel]')
  return el ? el.offsetWidth + 20 : 0
}
