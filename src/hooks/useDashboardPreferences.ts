import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useUser, useUpdateUserPreferences } from './api/useUsers';
import { DashboardPreferences, WidgetConfig, WidgetId } from '../types';

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'spendingHeatmap', enabled: true, order: 0 },
  { id: 'insights', enabled: true, order: 1 },
  { id: 'trends', enabled: true, order: 2 },
  { id: 'forecast', enabled: true, order: 3 },
  { id: 'creditCards', enabled: true, order: 4 },
  { id: 'savingsGoals', enabled: true, order: 5 },
  { id: 'projectedBalance', enabled: true, order: 6 },
  { id: 'balanceEvolution', enabled: true, order: 7 },
  { id: 'monthlyComparison', enabled: true, order: 8 },
  { id: 'budgetVsRealized', enabled: true, order: 9 },
  { id: 'fixedVsVariable', enabled: true, order: 10 },
  { id: 'dailyCashFlow', enabled: true, order: 11 },
  { id: 'incomeSplit', enabled: true, order: 12 },
];

export const useDashboardPreferences = () => {
  const { currentUser } = useAuth();
  const { data: user, isLoading: userLoading } = useUser();
  const updatePreferences = useUpdateUserPreferences();
  
  const [preferences, setPreferences] = useState<DashboardPreferences>({
    widgets: DEFAULT_WIDGETS,
  });

  // Carregar preferências do backend
  useEffect(() => {
    if (!currentUser || userLoading) {
      if (!currentUser) {
        setPreferences({ widgets: DEFAULT_WIDGETS });
      }
      return;
    }

    if (user?.dashboardPreferences) {
      const prefs = user.dashboardPreferences as DashboardPreferences;
      // Garantir que todos os widgets padrão existam
      const mergedWidgets = DEFAULT_WIDGETS.map(defaultWidget => {
        const savedWidget = prefs.widgets?.find(w => w.id === defaultWidget.id);
        if (savedWidget) {
          return {
            ...savedWidget,
            order: savedWidget.order ?? defaultWidget.order,
            enabled: savedWidget.enabled ?? defaultWidget.enabled,
          };
        }
        return defaultWidget;
      });
      
      // Ordenar pela ordem salva
      const sortedWidgets = mergedWidgets.sort((a, b) => a.order - b.order);
      
      setPreferences({
        widgets: sortedWidgets,
      });
    } else {
      setPreferences({ widgets: DEFAULT_WIDGETS });
    }
  }, [currentUser, user, userLoading]);

  // Salvar preferências no backend
  const savePreferences = useCallback(async (newPreferences: DashboardPreferences) => {
    if (!currentUser) return;

    await updatePreferences.mutateAsync({
      dashboardPreferences: newPreferences,
    });
    setPreferences(newPreferences);
  }, [currentUser, updatePreferences]);

  // Atualizar ordem dos widgets
  const updateWidgetOrder = useCallback(async (widgets: WidgetConfig[]) => {
    // Garantir que todos os widgets tenham a ordem correta
    const reorderedWidgets = widgets
      .map((widget, index) => ({ ...widget, order: index }))
      .sort((a, b) => a.order - b.order);
    
    const newPreferences: DashboardPreferences = {
      widgets: reorderedWidgets,
    };
    
    await savePreferences(newPreferences);
  }, [savePreferences]);

  // Alternar visibilidade de um widget
  const toggleWidget = useCallback(async (widgetId: WidgetId) => {
    const newWidgets = preferences.widgets.map(widget =>
      widget.id === widgetId
        ? { ...widget, enabled: !widget.enabled }
        : widget
    );
    const newPreferences: DashboardPreferences = {
      widgets: newWidgets,
    };
    await savePreferences(newPreferences);
  }, [preferences.widgets, savePreferences]);

  // Obter widgets habilitados ordenados
  const getEnabledWidgets = useCallback((): WidgetConfig[] => {
    return preferences.widgets
      .filter(w => w.enabled)
      .sort((a, b) => a.order - b.order);
  }, [preferences.widgets]);

  // Resetar widgets para o padrão
  const resetToDefault = useCallback(async () => {
    const defaultPreferences: DashboardPreferences = {
      widgets: DEFAULT_WIDGETS,
    };
    await savePreferences(defaultPreferences);
  }, [savePreferences]);

  return {
    preferences,
    loading: userLoading,
    savePreferences,
    updateWidgetOrder,
    toggleWidget,
    getEnabledWidgets,
    resetToDefault,
  };
};

