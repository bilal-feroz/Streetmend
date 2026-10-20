import { useApp } from '../state/store'

export function MunicipalPanel() {
  const sc = useApp((s) => s.scenario)
  return (
    <div className="p-4 text-[13px] text-fg-2">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-2">Charlotte Data Explorer</h2>
      <p className="mt-2">{sc?.description}</p>
    </div>
  )
}
