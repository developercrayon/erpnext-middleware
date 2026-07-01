import React from 'react'
import { ValueGroup } from '@adminjs/design-system'
import { useTranslation } from 'adminjs'

const IST_TIMEZONE = 'Asia/Kolkata'

const formatIST = (value) => {
  if (!value) return '-'
  try {
    const date = new Date(value)
    if (isNaN(date.getTime())) return String(value)
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: IST_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date)
  } catch (e) {
    return String(value)
  }
}

const DateIst = (props) => {
  const { property, record, where } = props || {}
  const rawValue = record?.params?.[property?.path]
  const formatted = formatIST(rawValue)
  const isoTitle = rawValue ? (() => { try { return new Date(rawValue).toISOString() } catch { return '' } })() : ''
  const { translateProperty } = useTranslation()

  // If this component is used in the 'show' view, wrap it in ValueGroup
  if (where === 'show') {
    return (
      <ValueGroup label={translateProperty(property.label, property.resourceId)}>
        <span title={isoTitle}>{formatted}</span>
      </ValueGroup>
    )
  }

  // Otherwise (e.g. 'list' view), just render the span
  return (
    <span title={isoTitle} style={{ whiteSpace: 'nowrap' }}>
      {formatted}
    </span>
  )
}

export default DateIst
