#!/usr/bin/env python3
"""
Solana WebSocket Benchmark - Tests the performance of WebSocket RPC providers
"""

import time
import json
import statistics
import argparse
from datetime import datetime
import sys
import os
import asyncio
import websockets
import pathlib

# ANSI color codes for pretty output
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'
    END = '\033[0m'
    
    # Background colors
    BG_BLACK = '\033[40m'
    BG_RED = '\033[41m'
    BG_GREEN = '\033[42m'
    BG_YELLOW = '\033[43m'
    BG_BLUE = '\033[44m'
    BG_MAGENTA = '\033[45m'
    BG_CYAN = '\033[46m'
    BG_WHITE = '\033[47m'

# Flag to enable/disable Branch RPC (defaults to False - disabled)
ENABLE_BRANCH_RPC = False

# Default WebSocket endpoints
DEFAULT_ENDPOINTS = {
    "HeliusWS": "wss://mainnet.helius-rpc.com/?api-key=8fd1a2cd-76e7-4462-b38b-1026960edd40",
    "OfficialWS": "wss://api.mainnet-beta.solana.com",
    "QuikNodeWS": "wss://still-neat-log.solana-mainnet.quiknode.pro/2a0ede8be35aa5c655c08939f1831e8fb52ddeba/"
}

# Conditional Branch RPC addition 
if ENABLE_BRANCH_RPC:
    DEFAULT_ENDPOINTS["BranchWS"] = "ws://162.249.175.2:8900"

# Methods to test - Reliably supported WebSocket RPC methods with practical DegenDuel examples
DEFAULT_METHODS = [
    # Basic version check - light and consistently supported
    ("getVersion", []),
    
    # Get SOL token account info - standard token info retrieval
    ("getAccountInfo", [{"pubkey": "So11111111111111111111111111111111111111112", "commitment": "processed", "encoding": "jsonParsed"}]),
    
    # Get a recent blockhash - critical for transaction building
    ("getRecentBlockhash", [{"commitment": "processed"}]),
    
    # Get Pumpswap liquidity pools (limited to 3 results) - real-world use case for trading
    ("getProgramAccounts", [
        "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", 
        {
            "encoding": "jsonParsed",
            "commitment": "processed",
            "filters": [
                {"dataSize": 380}  # Filter for pool accounts (typical size)
            ],
            "limit": 3  # Limit results to avoid excessive data
        }
    ])
]

# Global constants
BAR_START_POSITION = 36  # Position where all bars should start (used across all sections)

def create_horizontal_bar(value, max_value, width=40, color=Colors.BLUE):
    """Creates a colorized horizontal bar"""
    if max_value == 0:
        filled_length = 0
    else:
        filled_length = int(round(width * value / max_value))

    bar = color + '█' * filled_length + Colors.END + '░' * (width - filled_length)
    return bar

def create_relative_bar(value, best_value, width=40, color=Colors.BLUE):
    """Creates a bar showing relative performance compared to the best value
    For latency: Lower is better, so we use inverse proportion
    """
    # Direct inverse proportion: if you're 2x slower, your bar is 1/2 as long
    # If latency is twice the best_value, bar should be half as long
    ratio = best_value / value  # This gives 1.0 for best, and smaller values for worse
    bar_width = int(ratio * width)
    
    # Create a bar based on relative performance
    return color + '█' * bar_width + Colors.END

def latency_color(latency, thresholds=(50, 100, 200)):
    """Return color based on latency value"""
    if latency < thresholds[0]:
        return Colors.GREEN
    elif latency < thresholds[1]:
        return Colors.BLUE
    elif latency < thresholds[2]:
        return Colors.YELLOW
    else:
        return Colors.RED

async def test_ws_connection(endpoint, num_tests=3):
    """Tests basic WebSocket connection latency"""
    print(f"{Colors.BOLD}{Colors.UNDERLINE}Testing WebSocket connection to {endpoint}...{Colors.END}")
    
    latencies = []
    for i in range(num_tests):
        start_time = time.time()
        try:
            async with websockets.connect(endpoint, ping_interval=None, close_timeout=5) as websocket:
                latency = (time.time() - start_time) * 1000  # ms
                latencies.append(latency)
                color = latency_color(latency)
                print(f"  Connection {i+1}: {color}{latency:.2f}ms{Colors.END}")
        except Exception as e:
            print(f"  Connection {i+1}: {Colors.RED}Failed - {str(e)}{Colors.END}")
        await asyncio.sleep(0.5)
    
    if latencies:
        print(f"\n{Colors.BOLD}WebSocket connection latency to {endpoint}:{Colors.END}")
        
        # We just use absolute values here, as we'll do real relative comparison in the summary
        max_latency = max(latencies) * 1.2  # Add 20% padding
        
        # Min latency with bar
        min_lat = min(latencies)
        color = latency_color(min_lat)
        bar = create_horizontal_bar(min_lat, max_latency, width=30, color=color)
        print(f"  Min: {color}{min_lat:.2f}ms{Colors.END} {bar}")
        
        # Avg latency with bar
        avg_lat = statistics.mean(latencies)
        color = latency_color(avg_lat)
        bar = create_horizontal_bar(avg_lat, max_latency, width=30, color=color)
        print(f"  Avg: {color}{avg_lat:.2f}ms{Colors.END} {bar}")
        
        # Max latency with bar
        max_lat = max(latencies)
        color = latency_color(max_lat)
        bar = create_horizontal_bar(max_lat, max_latency, width=30, color=color)
        print(f"  Max: {color}{max_lat:.2f}ms{Colors.END} {bar}")
        
        if len(latencies) > 1:
            std_dev = statistics.stdev(latencies)
            print(f"  Stddev: {Colors.CYAN}{std_dev:.2f}ms{Colors.END}")
    else:
        print(f"\n{Colors.RED}No successful connections to {endpoint}{Colors.END}")
    
    print("")
    return latencies

async def test_ws_rpc_method(name, endpoint, method, params=None, num_tests=3):
    """Tests the latency of a specific WebSocket RPC method call"""
    if params is None:
        params = []
    
    print(f"{Colors.BOLD}{Colors.CYAN}{name}:{Colors.END}")
    
    latencies = []
    results = []
    
    try:
        async with websockets.connect(endpoint, ping_interval=None, close_timeout=5) as websocket:
            for i in range(num_tests):
                request = {
                    "jsonrpc": "2.0",
                    "id": i+1,
                    "method": method,
                    "params": params
                }
                
                start_time = time.time()
                await websocket.send(json.dumps(request))
                
                try:
                    response = await asyncio.wait_for(websocket.recv(), timeout=10)
                    latency = (time.time() - start_time) * 1000  # Convert to ms
                    
                    response_data = json.loads(response)
                    if 'error' in response_data:
                        print(f"  Test {i+1}: {Colors.RED}Error: {response_data['error']}{Colors.END}")
                        continue
                    
                    latencies.append(latency)
                    results.append(response_data)
                    
                    color = latency_color(latency)
                    print(f"  Test {i+1}: {color}{latency:.2f}ms{Colors.END}")
                    
                except asyncio.TimeoutError:
                    print(f"  Test {i+1}: {Colors.RED}Timeout after 10s{Colors.END}")
                except Exception as e:
                    print(f"  Test {i+1}: {Colors.RED}Failed: {str(e)}{Colors.END}")
                
                # Brief pause between tests
                await asyncio.sleep(0.5)
    except Exception as e:
        print(f"  {Colors.RED}Connection failed: {str(e)}{Colors.END}")
    
    if latencies:
        stats = {
            "min": min(latencies),
            "max": max(latencies),
            "avg": statistics.mean(latencies),
            "median": statistics.median(latencies),
            "stdev": statistics.stdev(latencies) if len(latencies) > 1 else 0,
            "count": len(latencies),
            "failures": num_tests - len(latencies)
        }
        
        # We just use absolute values here, as we'll do real relative comparison in the summary
        max_latency = max(latencies) * 1.2  # Add 20% padding
        
        # Min latency with bar
        min_lat = stats['min']
        color = latency_color(min_lat)
        bar = create_horizontal_bar(min_lat, max_latency, width=30, color=color)
        print(f"  Min: {color}{min_lat:.2f}ms{Colors.END} {bar}")
        
        # Median with bar
        median_lat = stats['median']
        color = latency_color(median_lat)
        bar = create_horizontal_bar(median_lat, max_latency, width=30, color=color)
        print(f"  Median: {color}{median_lat:.2f}ms{Colors.END} {bar}")
        
        # Avg latency with bar
        avg_lat = stats['avg']
        color = latency_color(avg_lat)
        bar = create_horizontal_bar(avg_lat, max_latency, width=30, color=color)
        print(f"  Avg: {color}{avg_lat:.2f}ms{Colors.END} {bar}")
        
        # Max latency with bar
        max_lat = stats['max']
        color = latency_color(max_lat)
        bar = create_horizontal_bar(max_lat, max_latency, width=30, color=color)
        print(f"  Max: {color}{max_lat:.2f}ms{Colors.END} {bar}")
        
        if stats['failures'] > 0:
            print(f"  Failures: {Colors.RED}{stats['failures']}/{num_tests}{Colors.END}")
            
        return stats, results
    else:
        print(f"  {Colors.RED}All tests failed{Colors.END}")
        return None, []

async def compare_ws_endpoints(endpoints, methods, num_tests=3, export_file=None):
    """Compares multiple WebSocket RPC endpoints across various methods"""
    results = {}
    timestamp = datetime.now()
    timestamp_str = timestamp.strftime('%Y-%m-%d %H:%M:%S')
    
    # Print header
    header = "SOLANA WEBSOCKET RPC ENDPOINT COMPARISON"
    print(f"\n{Colors.BG_BLUE}{Colors.BOLD} {header} {Colors.END}")
    print(f"{Colors.CYAN}Timestamp: {timestamp_str}{Colors.END}")
    print(f"{Colors.CYAN}Tests per method: {num_tests}{Colors.END}")
    print("")
    
    # Test WebSocket connection first
    print(f"{Colors.BG_YELLOW}{Colors.BOLD} WEBSOCKET CONNECTION TESTS {Colors.END}")
    connection_results = {}
    for name, endpoint in endpoints.items():
        latencies = await test_ws_connection(endpoint, num_tests)
        if latencies:
            connection_results[name] = {
                "min": min(latencies),
                "max": max(latencies),
                "avg": statistics.mean(latencies),
                "median": statistics.median(latencies),
                "stdev": statistics.stdev(latencies) if len(latencies) > 1 else 0
            }
    
    # Run the RPC tests
    for method, params in methods:
        section_header = f" Testing '{method}' method "
        print(f"\n{Colors.BG_CYAN}{Colors.BOLD}{section_header}{Colors.END}")
        
        if method not in results:
            results[method] = {}
        
        for name, endpoint in endpoints.items():
            stats, _ = await test_ws_rpc_method(name, endpoint, method, params, num_tests)
            if stats:
                results[method][name] = stats
    
    # Print performance summary
    print_ws_summary(results, connection_results, endpoints)
    
    # Export results to file if requested
    if export_file:
        try:
            export_data = {
                "timestamp": timestamp_str,
                "timestamp_unix": int(timestamp.timestamp()),
                "test_count": num_tests,
                "endpoints": endpoints,
                "connection_results": connection_results,
                "method_results": results,
            }
            
            # Create results directory if it doesn't exist
            results_dir = pathlib.Path('benchmark_results')
            results_dir.mkdir(exist_ok=True)
            
            # Generate filename with timestamp if not provided
            if export_file == True:  # If --export was used without a filename
                timestamp_file = timestamp.strftime('%Y%m%d_%H%M%S')
                export_file = f"ws_benchmark_results_{timestamp_file}.json"
            
            # Ensure file path is in the results directory
            if not str(export_file).startswith(str(results_dir)):
                export_file = results_dir / export_file
                
            # Write results to file
            with open(export_file, 'w') as f:
                json.dump(export_data, f, indent=2)
                
            print(f"\n{Colors.GREEN}Results exported to: {export_file}{Colors.END}")
        except Exception as e:
            print(f"\n{Colors.RED}Error exporting results: {str(e)}{Colors.END}")
    
    return results

def print_ws_summary(results, connection_results, endpoints):
    """Prints a summary of the benchmark results with color and charts"""
    summary_header = " WEBSOCKET PERFORMANCE SUMMARY "
    print(f"\n{Colors.BG_MAGENTA}{Colors.BOLD}{summary_header}{Colors.END}")
    
    # Connection latency summary
    print(f"\n{Colors.BOLD}{Colors.UNDERLINE}Connection Latency:{Colors.END}")
    if connection_results:
        providers_sorted = sorted(connection_results.keys(), 
                               key=lambda x: connection_results[x]["median"])
        
        # Get the best (lowest) value for relative scaling
        best_median = connection_results[providers_sorted[0]]["median"]
        
        for provider in providers_sorted:
            median = connection_results[provider]["median"]
            color = latency_color(median)
            
            # Create a bar that shows relative performance to the best
            bar = create_relative_bar(median, best_median, width=40, color=color)
            
            # Format the provider and value with exact spacing to align bars
            provider_display = f"{provider.ljust(10)}"
            value_str = f"{color}{median:<8.2f}ms{Colors.END}"
            
            # Calculate padding needed to reach BAR_START_POSITION
            current_len = 2 + 10 + 2 + 8 + 2  # "  " + provider(10) + ": " + value(8) + "ms "
            padding = max(0, BAR_START_POSITION - current_len)
            
            print(f"  {Colors.BOLD}{provider_display}{Colors.END}: {value_str}{' ' * padding}{bar}")
    
    # For each method, compare all providers
    for method in results:
        print(f"\n{Colors.BOLD}{Colors.UNDERLINE}{method}:{Colors.END}")
        
        if not results[method]:
            print(f"  {Colors.RED}No successful results for this method{Colors.END}")
            continue
            
        # Get all median values to determine max for bar scaling
        all_medians = [results[method][provider]["median"] for provider in results[method]]
        max_median = max(all_medians) * 1.2 if all_medians else 100
        
        # Display median values with relative bars
        providers_sorted = sorted(results[method].keys(), 
                               key=lambda x: results[method][x]["median"])
        
        # Get the best (lowest) value for relative scaling
        best_median = results[method][providers_sorted[0]]["median"]
        
        for provider in providers_sorted:
            median = results[method][provider]["median"]
            color = latency_color(median)
            
            # Create a bar that shows relative performance to the best
            bar = create_relative_bar(median, best_median, width=40, color=color)
            
            # Format the provider and value with exact spacing to align bars
            provider_display = f"{provider.ljust(10)}"
            value_str = f"{color}{median:<8.2f}ms{Colors.END}"
            
            # Calculate padding needed to reach BAR_START_POSITION
            current_len = 2 + 10 + 2 + 8 + 2  # "  " + provider(10) + ": " + value(8) + "ms "
            padding = max(0, BAR_START_POSITION - current_len)
            
            print(f"  {Colors.BOLD}{provider_display}{Colors.END}: {value_str}{' ' * padding}{bar}")
    
    # Overall ranking
    overall_header = " OVERALL WEBSOCKET RANKING "
    print(f"\n{Colors.BG_BLUE}{Colors.BOLD}{overall_header}{Colors.END}")
    
    provider_rankings = {provider: [] for provider in endpoints}
    for method in results:
        providers = []
        for provider in results[method]:
            providers.append((provider, results[method][provider]["median"]))
        
        providers.sort(key=lambda x: x[1])
        for rank, (provider, _) in enumerate(providers):
            provider_rankings[provider].append(rank + 1)
    
    avg_rankings = []
    for provider, rankings in provider_rankings.items():
        if rankings:
            avg_rank = sum(rankings) / len(rankings)
            avg_rankings.append((provider, avg_rank))
    
    avg_rankings.sort(key=lambda x: x[1])
    max_rank = max([r for _, r in avg_rankings]) if avg_rankings else 3
    
    for i, (provider, avg_rank) in enumerate(avg_rankings):
        # Adjust spacing for medal/rank
        if i <= 2:
            medal = "🥇" if i == 0 else "🥈" if i == 1 else "🥉"
            position_part = f"{medal} "  # Medal with space after
        else:
            medal = f"{i+1}."
            position_part = f"{medal} "  # Number with space after
            
        # For overall ranking, create a relative bar based on average rank
        # The best (lowest) rank gets 100%, the worst gets proportionally less
        best_rank = avg_rankings[0][1]  # First item has the best (lowest) rank
        
        # Direct inverse proportion for ranks
        bar_color = Colors.GREEN if i == 0 else Colors.BLUE if i == 1 else Colors.YELLOW
        
        # Create relative bar - ratio of best rank to provider rank
        ratio = best_rank / avg_rank  # This gives 1.0 for best, smaller for worse
        bar_width = int(ratio * 40)
        bar = bar_color + '█' * bar_width + Colors.END
        
        # Format provider and value with exact spacing
        provider_str = f"{Colors.BOLD}{provider:<10}{Colors.END}"
        value_str = f"{Colors.CYAN}{avg_rank:<5.2f}{Colors.END} average rank"
        
        # Calculate padding needed to reach BAR_START_POSITION
        prefix_len = 2 + 3 + 1 + 10 + 2 + 5 + 13  # "  " + position(3) + space(1) + provider(10) + ": " + value(5) + " average rank "
        padding = max(0, BAR_START_POSITION - prefix_len)
        
        print(f"  {position_part}{provider_str}: {value_str}{' ' * padding}{bar}")

async def run_simple_benchmark(export_results=False):
    """Run a simple benchmark with default settings"""
    print(f"\n{Colors.BOLD}{Colors.YELLOW}Running simplified WebSocket RPC benchmark...{Colors.END}")
    await compare_ws_endpoints(
        endpoints=DEFAULT_ENDPOINTS,
        methods=DEFAULT_METHODS,
        num_tests=3,
        export_file=True if export_results else None
    )
    return 0

async def main_async():
    # Need to declare global variable only once at the beginning
    global ENABLE_BRANCH_RPC
    
    # Check if running in simple mode with export
    # Handle simple flags without parser for backward compatibility
    if "--enable-branch" in sys.argv:
        ENABLE_BRANCH_RPC = True
        # Add Branch RPC endpoint if it's not already there
        if "BranchWS" not in DEFAULT_ENDPOINTS:
            DEFAULT_ENDPOINTS["BranchWS"] = "ws://162.249.175.2:8900"
    
    if len(sys.argv) >= 2:
        if "--simple" in sys.argv:
            return await run_simple_benchmark()
        elif "--simple-export" in sys.argv:
            return await run_simple_benchmark(export_results=True)
    
    parser = argparse.ArgumentParser(description='Benchmark Solana WebSocket RPC providers')
    parser.add_argument('--endpoints', type=str, nargs='+', help='Custom WS endpoints in format name=url')
    parser.add_argument('--num-tests', type=int, default=3, help='Number of tests per method')
    parser.add_argument('--simple', action='store_true', help='Run in simplified mode')
    parser.add_argument('--export', nargs='?', const=True, help='Export results to JSON file (optionally specify filename)')
    parser.add_argument('--simple-export', action='store_true', help='Run simplified benchmark and export results')
    parser.add_argument('--enable-branch', action='store_true', help='Enable Branch RPC endpoint in tests')
    
    args = parser.parse_args()
    
    # Check if Branch RPC should be enabled
    if args.enable_branch:
        ENABLE_BRANCH_RPC = True
        # Add Branch RPC endpoint if it's not already there
        if "BranchWS" not in DEFAULT_ENDPOINTS:
            DEFAULT_ENDPOINTS["BranchWS"] = "ws://162.249.175.2:8900"
    
    if args.simple_export:
        return await run_simple_benchmark(export_results=True)
    elif args.simple:
        return await run_simple_benchmark(export_results=args.export is not None)
    
    # Set up endpoints
    endpoints = DEFAULT_ENDPOINTS.copy()
    if args.endpoints:
        for endpoint_arg in args.endpoints:
            try:
                name, url = endpoint_arg.split('=', 1)
                endpoints[name] = url
            except ValueError:
                print(f"{Colors.RED}Error: Invalid endpoint format '{endpoint_arg}'. Use 'name=url' format.{Colors.END}")
                return 1
    
    # Run the benchmark
    await compare_ws_endpoints(
        endpoints=endpoints,
        methods=DEFAULT_METHODS,
        num_tests=args.num_tests,
        export_file=args.export
    )
    
    return 0

def main():
    return asyncio.run(main_async())

if __name__ == "__main__":
    sys.exit(main())