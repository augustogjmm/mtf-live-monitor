-- v3.5.20 mark the four HD/PAMP Telegram re-sends as duplicate evidence.
-- The original deliveries are preserved in mtf_recovered_events from the user Telegram export.

update public.mtf_alert_events
set payload=coalesce(payload,'{}'::jsonb) || jsonb_build_object(
      'audit_duplicate',true,
      'duplicate_reason','telegram_repeat_after_original_pre_reset_delivery',
      'canonical_signal_id',case when symbol='HD' then 75 else 77 end,
      'canonical_delivery_source','USER_TELEGRAM_EXPORT_20260924'
    ),
    updated_at=now()
where id in (74,83,87,88);

update public.mtf_recovered_events
set payload=payload || jsonb_build_object('canonical_delivery',true)
where source='USER_TELEGRAM_EXPORT_20260924'
  and event_type='ENTRY'
  and symbol in ('HD','PAMP');
