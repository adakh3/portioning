"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ClientEmailSettings from "@/components/ClientEmailSettings";

interface SettingsShape {
  default_client_channel?: string;
  whatsapp_enabled?: boolean;
  whatsapp_shortcuts_enabled?: boolean;
  twilio_configured?: boolean;
  twilio_whatsapp_number?: string;
}

function Row({ name, helper, testId, children }: {
  name: string; helper: string; testId: string; children: React.ReactNode;
}) {
  return (
    <div
      // Each row is a distinct concern in one card, so tests scope to a row
      // rather than to the card (whose three rows share words like "Connected").
      data-testid={testId}
      className="grid gap-5 border-t border-border py-5 md:grid-cols-[180px_1fr]"
    >
      <div>
        <h3 className="text-sm font-medium text-foreground">{name}</h3>
        <p className="text-xs text-muted-foreground">{helper}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

/**
 * Settings → Client communications (REL-445).
 *
 * One card, because an org's messaging setup is one question. It also encodes
 * the rule the whole feature rests on: **an org never picks a "mechanism", it
 * configures capabilities and the mechanism follows.** There is no mode switch
 * here and there must never be one — configuring a Twilio number is what
 * upgrades WhatsApp from a shortcut to a platform send.
 */
export default function ClientCommunicationsSettings({
  settings, onSave,
}: { settings: SettingsShape | undefined; onSave: () => void }) {
  const [channel, setChannel] = useState("whatsapp");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const [waEnabled, setWaEnabled] = useState(false);
  const [shortcuts, setShortcuts] = useState(true);
  const [waSaving, setWaSaving] = useState<"enabled" | "shortcuts" | null>(null);

  useEffect(() => {
    if (!settings) return;
    setChannel(settings.default_client_channel || "whatsapp");
    setWaEnabled(settings.whatsapp_enabled || false);
    setShortcuts(settings.whatsapp_shortcuts_enabled !== false);
  }, [settings]);

  const platform = !!(settings?.twilio_configured && waEnabled);

  async function saveChannel(value: string) {
    setChannel(value);
    setSaving(true);
    setError("");
    setSaved("");
    try {
      await api.updateSiteSettings({ default_client_channel: value });
      setSaved("Default channel saved.");
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(which: "enabled" | "shortcuts", value: boolean) {
    setWaSaving(which);
    setError("");
    try {
      if (which === "enabled") {
        await api.updateSiteSettings({ whatsapp_enabled: value });
        setWaEnabled(value);
      } else {
        await api.updateSiteSettings({ whatsapp_shortcuts_enabled: value });
        setShortcuts(value);
      }
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setWaSaving(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Client communications</CardTitle>
        <p className="text-sm text-muted-foreground">
          Connect your email. Add a WhatsApp business number if you have one — otherwise
          WhatsApp uses your phone. Pick which one we suggest first.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

        <Row
          name="Default channel"
          helper="Pre-seeded from your country. Editable any time."
          testId="settings-default-channel-row"
        >
          <select
            aria-label="Default channel"
            value={channel}
            disabled={saving}
            onChange={(e) => saveChannel(e.target.value)}
            className="h-9 w-[200px] rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <p className="mt-2 text-xs text-muted-foreground">
            Decides which channel the send modal preselects. A contact&apos;s own preferred
            channel always overrides it.
          </p>
          {saved && <p className="mt-1 text-xs text-success">{saved}</p>}
        </Row>

        <Row name="Email" helper="Sends come from your own mailbox." testId="settings-email-row">
          <ClientEmailSettings embedded />
        </Row>

        <Row name="WhatsApp" helper="Always available. How it sends is derived." testId="settings-whatsapp-row">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {platform ? (
                <>
                  <Badge variant="info">Business number</Badge>
                  <span className="text-sm text-muted-foreground">
                    Via Twilio: <span className="font-medium text-foreground">{settings?.twilio_whatsapp_number}</span> — platform-sent, delivery tracked.
                  </span>
                </>
              ) : (
                <>
                  <Badge variant="secondary">Shortcuts</Badge>
                  <span className="text-sm text-muted-foreground">
                    Messages open in your own WhatsApp for you to send.
                  </span>
                </>
              )}
            </div>

            {settings?.twilio_configured ? (
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-muted-foreground">
                  Configuring a Twilio WhatsApp number upgraded this automatically — there
                  is no mode to switch. Turn WhatsApp off to force shortcuts.
                </p>
                <Button
                  variant={waEnabled ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggle("enabled", !waEnabled)}
                  disabled={waSaving !== null}
                >
                  {waSaving === "enabled" ? "Saving..." : waEnabled ? "Enabled" : "Disabled"}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Add a WhatsApp business number and the same WhatsApp button starts sending
                from the platform with delivery status. Nothing else changes for your team.
              </p>
            )}

            {/* The second off-switch. Turning this off is a decision — no send
                may quietly fall back to a salesperson's personal number. */}
            <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
              <div>
                <p className="text-sm font-medium text-foreground">WhatsApp shortcuts</p>
                <p className="text-xs text-muted-foreground">
                  When platform sending isn&apos;t active, open WhatsApp on the
                  salesperson&apos;s own device with the message prefilled. Turn off to
                  disallow personal-number outreach entirely.
                </p>
              </div>
              <Button
                variant={shortcuts ? "default" : "outline"}
                size="sm"
                onClick={() => toggle("shortcuts", !shortcuts)}
                disabled={waSaving !== null}
              >
                {waSaving === "shortcuts" ? "Saving..." : shortcuts ? "Enabled" : "Disabled"}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Number configuration lives in Django admin today — moving it here is REL-356,
              not part of this wave.
            </p>
          </div>
        </Row>
      </CardContent>
    </Card>
  );
}
