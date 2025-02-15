# DegenDuel Wallet Management System - Frontend Implementation Guide

## Core Pages Implementation

### 1. Wallet Monitoring Dashboard

```typescript
// Core state interface
interface DashboardState {
    wallets: WalletDetails[];
    stats: {
        total_wallets: number;
        active_contests: number;
        total_balance: number;
        needs_sync: number;
        status_breakdown: Record<string, number>;
    };
    filters: {
        status?: string;
        search?: string;
        sortBy?: string;
        sortDir?: 'asc' | 'desc';
    };
}

// WebSocket events to implement
const WS_EVENTS = {
    WALLET_UPDATED: 'wallet:updated',
    BALANCE_CHANGED: 'balance:changed',
    SYNC_NEEDED: 'sync:needed'
};
```

#### Implementation
1. **Stats Header**
   ```typescript
   const StatsHeader = () => {
       const stats = useWalletStats();
       return (
           <Grid container spacing={2}>
               <StatCard title="Total Wallets" value={stats.total_wallets} />
               <StatCard title="Active Contests" value={stats.active_contests} />
               <StatCard title="Total Balance" value={formatSOL(stats.total_balance)} />
               <StatCard 
                   title="Needs Sync" 
                   value={stats.needs_sync}
                   alert={stats.needs_sync > 0} 
               />
           </Grid>
       );
   };
   ```

2. **Wallet List**
   ```typescript
   const WalletList = () => {
       const [wallets, setWallets] = useState<WalletDetails[]>([]);
       const [filters, setFilters] = useState<FilterState>({});
       
       // Real-time updates
       useEffect(() => {
           socket.on(WS_EVENTS.WALLET_UPDATED, handleWalletUpdate);
           socket.on(WS_EVENTS.BALANCE_CHANGED, handleBalanceChange);
           return () => {
               socket.off(WS_EVENTS.WALLET_UPDATED);
               socket.off(WS_EVENTS.BALANCE_CHANGED);
           };
       }, []);

       return (
           <DataGrid
               rows={wallets}
               columns={[
                   { field: 'wallet_address', headerName: 'Wallet', width: 200 },
                   { field: 'contest_code', headerName: 'Contest', width: 150 },
                   { 
                       field: 'current_balance',
                       headerName: 'Balance',
                       renderCell: (params) => formatSOL(params.value)
                   },
                   {
                       field: 'actions',
                       headerName: 'Actions',
                       renderCell: (params) => <WalletActions wallet={params.row} />
                   }
               ]}
               onFilterChange={handleFilterChange}
               onSortChange={handleSortChange}
           />
       );
   };
   ```

### 2. Wallet Generation Interface

```typescript
interface GenerationState {
    contest_id: number | null;
    pattern: string;
    isGenerating: boolean;
    preview: {
        pattern: string;
        example: string;
        complexity: 'low' | 'medium' | 'high';
    } | null;
}
```

#### Implementation
```typescript
const WalletGeneration = () => {
    const [state, setState] = useState<GenerationState>(initialState);
    const [contests] = useContests();

    const handlePatternChange = async (pattern: string) => {
        if (!pattern) return;
        const preview = await checkVanityPattern(pattern);
        setState(prev => ({ ...prev, pattern, preview }));
    };

    const generateWallet = async () => {
        setState(prev => ({ ...prev, isGenerating: true }));
        try {
            const wallet = await createContestWallet({
                contest_id: state.contest_id,
                preferred_pattern: state.pattern,
                admin_context: getAdminContext()
            });
            
            // Notify success and update lists
            notifySuccess('Wallet generated successfully');
            refreshWalletList();
            
        } catch (error) {
            notifyError('Failed to generate wallet');
        } finally {
            setState(prev => ({ ...prev, isGenerating: false }));
        }
    };

    return (
        <Card>
            <CardHeader title="Generate Contest Wallet" />
            <CardContent>
                <ContestSelect
                    contests={contests}
                    value={state.contest_id}
                    onChange={id => setState(prev => ({ ...prev, contest_id: id }))}
                />
                
                <VanityPatternInput
                    value={state.pattern}
                    onChange={handlePatternChange}
                    preview={state.preview}
                />
                
                <LoadingButton
                    loading={state.isGenerating}
                    disabled={!state.contest_id}
                    onClick={generateWallet}
                >
                    Generate Wallet
                </LoadingButton>
            </CardContent>
        </Card>
    );
};
```

### 3. Administrative Controls

```typescript
interface AdminState {
    selectedWallet: string | null;
    operations: {
        rake: boolean;
        sync: boolean;
        emergency: boolean;
    };
    auditLog: AuditEntry[];
}

interface AuditEntry {
    action: string;
    admin: string;
    timestamp: string;
    details: any;
}
```

#### Implementation
```typescript
const AdminControls = () => {
    const [state, setState] = useState<AdminState>(initialState);
    const { permissions } = useAdminContext();

    // Real-time audit log updates
    useEffect(() => {
        socket.on('audit:new', handleAuditEntry);
        return () => socket.off('audit:new');
    }, []);

    const handleRake = async (wallet: string) => {
        try {
            await rakeWallet({
                wallet_address: wallet,
                admin_address: getCurrentAdmin(),
                reason: 'Manual rake operation'
            });
            notifySuccess('Rake operation successful');
        } catch (error) {
            notifyError('Rake operation failed');
        }
    };

    return (
        <Grid container spacing={2}>
            <Grid item xs={12} md={8}>
                <Card>
                    <CardHeader title="Wallet Operations" />
                    <CardContent>
                        <WalletSelector
                            value={state.selectedWallet}
                            onChange={wallet => setState(prev => ({
                                ...prev,
                                selectedWallet: wallet
                            }))}
                        />
                        
                        <OperationsPanel
                            wallet={state.selectedWallet}
                            permissions={permissions}
                            onRake={handleRake}
                            onSync={handleSync}
                            onEmergencyStop={handleEmergencyStop}
                        />
                    </CardContent>
                </Card>
            </Grid>
            
            <Grid item xs={12} md={4}>
                <AuditLogPanel entries={state.auditLog} />
            </Grid>
        </Grid>
    );
};
```

## API Integration

```typescript
// API client setup
const api = {
    getWallets: () => get('/api/admin/contest-wallets/overview'),
    generateWallet: (data: WalletGenerationRequest) => 
        post('/api/admin/contest-wallets', data),
    rakeWallet: (address: string, data: RakeRequest) =>
        post(`/api/admin/wallet-management/rake/${address}`, data),
    checkPattern: (pattern: string) =>
        get(`/api/admin/vanity-wallets/check-pattern?pattern=${pattern}`)
};

// WebSocket setup
const socket = io(WS_URL, {
    auth: { token: getAuthToken() },
    transports: ['websocket']
});

socket.on('connect', () => {
    socket.emit('subscribe:wallet-updates');
    socket.emit('subscribe:audit-log');
});
```

## Error Handling

```typescript
const ErrorBoundary = ({ children }) => {
    const [error, setError] = useState<Error | null>(null);
    
    if (error) {
        return (
            <ErrorDisplay
                error={error}
                onRetry={() => setError(null)}
                onReport={() => reportError(error)}
            />
        );
    }
    
    return children;
};

const notifyError = (message: string) => {
    toast.error(message, {
        position: 'top-right',
        autoClose: 5000
    });
};
```

## Security Implementation

```typescript
// RBAC implementation
const usePermissions = () => {
    const { user } = useAuth();
    return {
        canRake: hasPermission(user, 'RAKE_WALLET'),
        canGenerate: hasPermission(user, 'GENERATE_WALLET'),
        canEmergencyStop: hasPermission(user, 'EMERGENCY_STOP')
    };
};

// Request interceptor
api.interceptors.request.use(config => {
    config.headers['Authorization'] = `Bearer ${getAuthToken()}`;
    config.headers['X-CSRF-Token'] = getCsrfToken();
    return config;
});
```

## Styling

```typescript
// Theme configuration
const theme = createTheme({
    palette: {
        primary: {
            main: '#1E88E5',
            dark: '#1565C0'
        },
        error: {
            main: '#D32F2F'
        }
    },
    components: {
        MuiButton: {
            styleOverrides: {
                root: {
                    textTransform: 'none'
                }
            }
        }
    }
});

// Responsive styles
const useStyles = makeStyles(theme => ({
    dashboardContainer: {
        [theme.breakpoints.up('md')]: {
            padding: theme.spacing(3)
        },
        [theme.breakpoints.down('sm')]: {
            padding: theme.spacing(1)
        }
    }
}));
```

---
*Contact: DegenDuel Platform Team* 