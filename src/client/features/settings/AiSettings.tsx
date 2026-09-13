import { useEffect, useState } from 'react'
import { Bot, Sparkles } from 'lucide-react'
import { api, type AiStatusResponse } from '../../lib/api'
import { Button, IconButton } from '../../components/primitives'
import { Input, SettingRow, Segmented, Switch } from '../../components/form'
import { useAi } from '../../store/ai'
import { t } from '../../lib/i18n'

interface FormState {
  enabled: boolean
  provider: 'workers_ai' | 'openai_compat'
  model: string
  baseUrl: string
  apiKey: string
  dailyCharQuota: number
}

function fromStatus(status: AiStatusResponse | null): FormState {
  return {
    enabled: status?.settings.enabled ?? false,
    provider: status?.settings.provider ?? 'workers_ai',
    model: status?.settings.model ?? '',
    baseUrl: status?.settings.baseUrl ?? '',
    apiKey: '',
    dailyCharQuota: status?.settings.dailyCharQuota ?? 50_000,
  }
}

export function AiSettings() {
  const [status, setStatus] = useState<AiStatusResponse | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState<FormState>(fromStatus(null))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const loadStatus = useAi((s) => s.loadStatus)

  useEffect(() => {
    api.ai.status()
      .then((result) => {
        setStatus(result)
        setForm(fromStatus(result))
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true))
  }, [])

  const save = async (patch: Partial<FormState>) => {
    const next = { ...form, ...patch }
    setForm(next)
    setSaving(true)
    setMessage(null)
    try {
      const result = await api.ai.saveSettings({
        enabled: next.enabled,
        provider: next.provider,
        model: next.model,
        baseUrl: next.baseUrl,
        ...(next.apiKey === '' ? {} : { apiKey: next.apiKey }),
        dailyCharQuota: next.dailyCharQuota,
      })
      setStatus((current) => current
        ? { ...current, available: result.settings.enabled, settings: result.settings }
        : current)
      setForm((current) => ({ ...current, apiKey: '' }))
      void loadStatus(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return null
  const openai = form.provider === 'openai_compat'

  return (<div className="space-y-6">
    <section>
      <SettingRow
        title={t("settings.ai_enable")}
        description={t("settings.ai_enable_description")}
      >
        <Switch checked={form.enabled} onChange={(enabled) => void save({ enabled })} label={t("settings.ai_enable")}/>
      </SettingRow>

      <SettingRow title={t("settings.ai_provider")}>
        <Segmented<'workers_ai' | 'openai_compat'>
          label={t("settings.ai_provider")}
          value={form.provider}
          onChange={(provider) => void save({ provider })}
          options={[
            { value: 'workers_ai', label: t("settings.ai_provider_workers") },
            { value: 'openai_compat', label: t("settings.ai_provider_openai") },
          ]}
        />
      </SettingRow>

      {openai && (<>
        <SettingRow title={t("settings.ai_base_url")}>
          <Input
            value={form.baseUrl}
            placeholder="https://api.openai.com/v1"
            className="w-[260px]"
            onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
            onBlur={() => void save({})}
          />
        </SettingRow>
        <SettingRow
          title={t("settings.ai_api_key")}
          description={status?.settings.hasKey ? t("settings.ai_api_key_stored") : t("settings.ai_api_key_hint")}
        >
          <Input
            type="password"
            value={form.apiKey}
            placeholder={status?.settings.hasKey ? '••••••••' : 'sk-…'}
            className="w-[260px]"
            onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
            onBlur={() => form.apiKey !== '' && void save({ apiKey: form.apiKey })}
          />
        </SettingRow>
      </>)}

      <SettingRow title={t("settings.ai_model")}>
        <Input
          value={form.model}
          placeholder={openai ? 'gpt-4o-mini' : '@cf/meta/llama-3.3-70b-instruct-fp8-fast'}
          className="w-[260px]"
          onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
          onBlur={() => void save({ model: form.model })}
        />
      </SettingRow>

      <SettingRow title={t("settings.ai_quota")} description={t("settings.ai_quota_description")}>
        <Input
          type="number"
          value={String(form.dailyCharQuota)}
          className="w-[140px]"
          onChange={(event) => setForm((current) => ({ ...current, dailyCharQuota: Number(event.target.value) || 0 }))}
          onBlur={() => void save({ dailyCharQuota: form.dailyCharQuota })}
        />
      </SettingRow>
    </section>

    {message !== null && (<p className="text-xs text-[var(--danger)]">{message}</p>)}

    <section>
      <h3 className="mb-1 text-[11px] font-semibold tracking-[0.06em] text-[var(--text-quaternary)]">{t("settings.ai_usage")}</h3>
      <p className="text-xs text-[var(--text-tertiary)]">
        {status
          ? `${status.usage.usedChars} / ${status.usage.quotaChars} ${t("ai.panel.quota_chars")}`
          : t("settings.ai_usage_unknown")}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--text-quaternary)]">
        <Bot size={12}/>{t("settings.ai_privacy_note")}
        <Sparkles size={12}/>{t("settings.ai_proxy_note")}
      </p>
    </section>

    <div className="flex items-center gap-2">
      <Button size="sm" onClick={() => void save({})} disabled={saving}>{t("common.save")}</Button>
      {saving && <IconButton label={t("common.close")} size="sm"><span className="animate-pulse">…</span></IconButton>}
    </div>
  </div>)
}
