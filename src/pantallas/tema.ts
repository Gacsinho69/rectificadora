import type { ThemeConfig } from 'antd'

// Sobrio y denso, como un sistema de oficina: un solo azul, gris claro de fondo, bloques blancos con borde fino,
// letra de 13 px y controles de 28 px. El color va en los estados, nunca de adorno.
export const tema: ThemeConfig = {
  token: {
    colorPrimary: '#1e3a8a',
    colorInfo: '#1e3a8a',
    colorText: '#1b2430',
    colorTextSecondary: '#5b6673',
    colorTextTertiary: '#8b95a1',
    colorBorder: '#c9d0d9',
    colorBorderSecondary: '#e3e7ec',
    colorBgLayout: '#f3f4f6',
    colorWarning: '#c77700',
    borderRadius: 3,
    fontSize: 13,
    controlHeight: 28,
    fontFamily: "'Archivo Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  },
  components: {
    Table: {
      headerBg: '#f3f4f6',
      headerColor: '#5b6673',
      headerSplitColor: 'transparent',
      rowHoverBg: '#f7f8fa',
      borderColor: '#e6e9ee',
      cellPaddingBlockSM: 4,
      cellPaddingInlineSM: 8,
    },
    Tabs: { horizontalMargin: '0 0 12px 0' },
  },
}
