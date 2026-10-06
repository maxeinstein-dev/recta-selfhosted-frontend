import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrency } from '../../context/CurrencyContext';
import { useI18n } from '../../context/I18nContext';
import { formatCurrency } from '../../utils/format';
import { 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  format,
  getDay,
  addMonths,
  subMonths,
  startOfDay,
  endOfDay
} from 'date-fns';
import { ptBR as ptBRLocale } from 'date-fns/locale/pt-BR';
import { enUS as enUSLocale } from 'date-fns/locale/en-US';
import { es as esLocale } from 'date-fns/locale/es';
import { fr as frLocale } from 'date-fns/locale/fr';
import { ru as ruLocale } from 'date-fns/locale/ru';
import { ja as jaLocale } from 'date-fns/locale/ja';
import { zhCN as zhCNLocale } from 'date-fns/locale/zh-CN';
import { arSA as arSALocale } from 'date-fns/locale/ar-SA';
import { useSpendingHeatmap } from '../../hooks/api/useTransactions';
import { useDefaultHousehold } from '../../hooks/useDefaultHousehold';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

interface SpendingHeatmapWidgetProps {
  selectedMonth?: Date;
}

export const SpendingHeatmapWidget = ({ 
  selectedMonth = new Date() 
}: SpendingHeatmapWidgetProps) => {
  const navigate = useNavigate();
  const { baseCurrency } = useCurrency();
  const { t, locale } = useI18n();
  const { householdId } = useDefaultHousehold();
  
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(selectedMonth));
  const today = useMemo(() => new Date(), []);
  const currentMonthStart = useMemo(() => startOfMonth(today), [today]);
  
  // Atualizar quando selectedMonth mudar externamente
  useEffect(() => {
    setCurrentMonth(startOfMonth(selectedMonth));
  }, [selectedMonth]);
  
  // Calcular limites de navegação (3 meses para frente e para trás)
  const minMonth = useMemo(() => subMonths(currentMonthStart, 3), [currentMonthStart]);
  const maxMonth = useMemo(() => addMonths(currentMonthStart, 3), [currentMonthStart]);
  
  const canGoBack = currentMonth > minMonth;
  const canGoForward = currentMonth < maxMonth;
  
  const handlePreviousMonth = () => {
    if (canGoBack) {
      setCurrentMonth(subMonths(currentMonth, 1));
    }
  };
  
  const handleNextMonth = () => {
    if (canGoForward) {
      setCurrentMonth(addMonths(currentMonth, 1));
    }
  };

  // Format month for API (YYYY-MM)
  const monthParam = useMemo(() => {
    return format(currentMonth, 'yyyy-MM');
  }, [currentMonth]);

  // Fetch heatmap data using optimized endpoint
  const { data: heatmapData, isLoading } = useSpendingHeatmap({
    householdId: householdId || undefined,
    month: monthParam,
  });

  const currentLocale = useMemo(() => {
    switch (locale) {
      case 'pt-BR':
        return ptBRLocale;
      case 'en-US':
        return enUSLocale;
      case 'es-ES':
        return esLocale;
      case 'fr-FR':
        return frLocale;
      case 'ru-RU':
        return ruLocale;
      case 'ja-JP':
        return jaLocale;
      case 'zh-CN':
        return zhCNLocale;
      case 'ar-SA':
        return arSALocale;
      default:
        return enUSLocale;
    }
  }, [locale]);

  // Get spending data from backend response
  const spendingByDayOfMonth = useMemo(() => {
    if (!heatmapData?.data) return [];
    return heatmapData.data;
  }, [heatmapData]);

  const maxAmount = useMemo(() => {
    if (spendingByDayOfMonth.length === 0) return 1;
    return Math.max(...spendingByDayOfMonth.map(d => d.amount), 1);
  }, [spendingByDayOfMonth]);

  // Calculate month boundaries for week grid
  const monthStart = useMemo(() => startOfMonth(currentMonth), [currentMonth]);
  const monthEnd = useMemo(() => endOfMonth(currentMonth), [currentMonth]);

  // Organizar por semanas (estilo GitHub) - sempre 6 semanas para altura fixa
  const weeks = useMemo(() => {
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    
    const weeks: Array<Array<{ day: number; amount: number; date: Date }>> = [];
    let currentWeek: Array<{ day: number; amount: number; date: Date }> = [];
    
    // Preencher dias vazios no início da primeira semana
    const firstDayOfWeek = getDay(monthStart);
    for (let i = 0; i < firstDayOfWeek; i++) {
      currentWeek.push({ day: 0, amount: 0, date: new Date() });
    }
    
    days.forEach(day => {
      const dayData = spendingByDayOfMonth.find(d => d.day === day.getDate());
      currentWeek.push({
        day: day.getDate(),
        amount: dayData?.amount || 0,
        date: day,
      });
      
      if (getDay(day) === 6) { // Domingo = 0, Sábado = 6
        weeks.push(currentWeek);
        currentWeek = [];
      }
    });
    
    // Preencher dias vazios no final da última semana
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push({ day: 0, amount: 0, date: new Date() });
      }
      weeks.push(currentWeek);
    }
    
    // Garantir sempre 6 semanas para altura fixa
    while (weeks.length < 6) {
      weeks.push(Array(7).fill({ day: 0, amount: 0, date: new Date() }));
    }
    
    return weeks;
  }, [monthStart, monthEnd, spendingByDayOfMonth]);

  const getIntensity = (amount: number): number => {
    if (amount === 0) return 0;
    const intensity = Math.min(amount / maxAmount, 1);
    return Math.ceil(intensity * 4); // 0-4 levels (5 níveis total)
  };

  const getColorClass = (intensity: number): string => {
    // Cores para gastos - gradiente vermelho/laranja (quanto mais escuro, mais gasto)
    const colors = [
      'bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700', // 0 - nenhum gasto
      'bg-[#ffc1cc] dark:bg-[#4a1a1a]', // 1 - baixo (rosa claro)
      'bg-[#ff8a95] dark:bg-[#6b1f1f]', // 2 - médio-baixo (rosa médio)
      'bg-[#ff6b7a] dark:bg-[#8b2525]', // 3 - médio (vermelho claro)
      'bg-[#ff4757] dark:bg-[#b82e2e]', // 4 - alto (vermelho)
      'bg-[#ee2c3c] dark:bg-[#d63031]', // 5 - muito alto (vermelho escuro)
    ];
    return colors[intensity] || colors[0];
  };

  const handleDayClick = (dayDate: Date) => {
    // Navegar para transações filtradas por despesas do dia específico
    const dayStart = startOfDay(dayDate);
    const dayEnd = endOfDay(dayDate);
    
    // Formatar datas no formato ISO (YYYY-MM-DD)
    const startDateStr = format(dayStart, 'yyyy-MM-dd');
    const endDateStr = format(dayEnd, 'yyyy-MM-dd');
    
    navigate(`/app/transactions?type=EXPENSE&startDate=${startDateStr}&endDate=${endDateStr}`);
  };

  const totalSpending = useMemo(() => {
    return heatmapData?.total || 0;
  }, [heatmapData]);

  const daysOfWeek = useMemo(() => {
    // Get localized day names
    const baseDate = new Date(2024, 0, 7); // Sunday
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(baseDate);
      date.setDate(baseDate.getDate() + i);
      return format(date, 'EEE', { locale: currentLocale });
    });
  }, [currentLocale]);

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6 flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary-600 dark:text-primary-400" />
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
            {t.spendingByDayOfMonth}
          </h3>
          <span
            className="text-xs font-light text-gray-500 dark:text-gray-400"
            title={t.cashDateNoteTitle || 'O mapa mostra quando o dinheiro saiu (data), mesmo que a despesa conte para outro mês.'}
          >
            ({t.cashDateNote || 'por data de caixa'})
          </span>
        </div>
        
        {/* Navegação de meses */}
        <div className="flex items-center gap-2">
          <button
            onClick={handlePreviousMonth}
            disabled={!canGoBack}
            className={`p-1 rounded-md transition-colors ${
              canGoBack
                ? 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-primary-600 dark:hover:text-primary-400'
                : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
            }`}
            aria-label={t.previousMonth}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          
          <div className="text-xs text-gray-700 dark:text-gray-300 font-medium min-w-[80px] text-center">
            {format(currentMonth, 'MMM yyyy', { locale: currentLocale })}
          </div>
          
          <button
            onClick={handleNextMonth}
            disabled={!canGoForward}
            className={`p-1 rounded-md transition-colors ${
              canGoForward
                ? 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-primary-600 dark:hover:text-primary-400'
                : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
            }`}
            aria-label={t.nextMonth}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Legenda - cores para gastos */}
      <div className="flex items-center justify-end gap-2.5 mb-4 text-[10px] text-gray-500 dark:text-gray-400">
        <span className="text-gray-400 dark:text-gray-500">{t.less}</span>
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-sm bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700" />
          <div className="w-2.5 h-2.5 rounded-sm bg-[#ffc1cc] dark:bg-[#4a1a1a]" />
          <div className="w-2.5 h-2.5 rounded-sm bg-[#ff8a95] dark:bg-[#6b1f1f]" />
          <div className="w-2.5 h-2.5 rounded-sm bg-[#ff6b7a] dark:bg-[#8b2525]" />
          <div className="w-2.5 h-2.5 rounded-sm bg-[#ff4757] dark:bg-[#b82e2e]" />
        </div>
        <span className="text-gray-400 dark:text-gray-500">{t.more}</span>
      </div>

      {/* Calendário Heatmap - layout tradicional */}
      <div className="mb-5">
        {/* Cabeçalho dos dias da semana */}
        <div className="grid grid-cols-7 gap-2 mb-2">
          {daysOfWeek.map((day, index) => (
            <div 
              key={`${day}-${index}`} 
              className="text-xs text-center text-gray-600 dark:text-gray-400 font-semibold uppercase tracking-wide"
            >
              {day.substring(0, 3)}
            </div>
          ))}
        </div>

        {/* Grid do calendário - 7 colunas, sempre 6 semanas para altura fixa */}
        <div className="grid grid-cols-7 gap-2 min-h-[240px]" style={{ gridTemplateRows: 'repeat(6, 1fr)' }}>
          {isLoading ? (
            // Loading skeleton
            Array.from({ length: 42 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="w-full rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse"
                style={{ aspectRatio: '1 / 1' }}
              />
            ))
          ) : (
            weeks.flatMap((week, weekIndex) =>
              week.map((dayData, dayIndex) => {
                if (dayData.day === 0) {
                  return (
                    <div 
                      key={`empty-${weekIndex}-${dayIndex}`} 
                      className="w-full"
                      style={{ aspectRatio: '1 / 1' }}
                    />
                  );
                }
                
                const intensity = getIntensity(dayData.amount);
                const colorClass = getColorClass(intensity);
                
                return (
                  <div
                    key={`${dayData.day}-${weekIndex}-${dayIndex}`}
                    onClick={() => handleDayClick(dayData.date)}
                    className={`${colorClass} w-full rounded-md relative group cursor-pointer transition-all duration-200 hover:ring-2 hover:ring-primary-500 dark:hover:ring-primary-400 hover:scale-105 hover:shadow-lg flex items-center justify-center`}
                    style={{ aspectRatio: '1 / 1' }}
                    title={`${dayData.day} ${format(dayData.date, 'MMM', { locale: currentLocale })}: ${formatCurrency(dayData.amount, baseCurrency)}`}
                  >
                    {/* Número do dia */}
                    <span className={`text-[11px] font-semibold ${
                      intensity === 0
                        ? 'text-gray-600 dark:text-gray-400'
                        : intensity >= 3
                        ? 'text-white dark:text-gray-100'
                        : 'text-gray-700 dark:text-gray-200'
                    }`}>
                      {dayData.day}
                    </span>
                    
                    {/* Tooltip - apenas no hover */}
                    {dayData.amount > 0 && (
                      <div className="absolute -top-16 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-[9999]">
                        <div className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs px-3 py-2 rounded-md shadow-2xl whitespace-nowrap border border-gray-700 dark:border-gray-300">
                          <div className="font-semibold mb-1 text-center">
                            {dayData.day} {format(dayData.date, 'MMM', { locale: currentLocale })}
                          </div>
                          <div className="font-medium text-center text-primary-300 dark:text-primary-600">
                            {formatCurrency(dayData.amount, baseCurrency)}
                          </div>
                        </div>
                        {/* Seta do tooltip */}
                        <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full">
                          <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent border-t-gray-900 dark:border-t-gray-100"></div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )
          )}
        </div>
      </div>

      <div className="pt-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t.monthlyTotal}:
        </span>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          {formatCurrency(totalSpending, baseCurrency)}
        </span>
      </div>
    </div>
  );
};
