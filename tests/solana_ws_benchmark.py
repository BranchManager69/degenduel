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
    "OfficialWS": "wss://api.mainnet-beta.solana.com"
}

# Conditional Branch RPC addition (only if enabled)
if ENABLE_BRANCH_RPC:
    DEFAULT_ENDPOINTS["BranchWS"] = "ws://162.249.175.2:8900"

# Methods to test
DEFAULT_METHODS = [
    ("getHealth", []),
    ("getLatestBlockhash", [{"commitment": "processed"}]),
    ("getSlot", []),
    ("getVersion", [])
]

def create_horizontal_bar(value, max_value, width=40, color=Colors.BLUE):
    """Creates a colorized horizontal bar"""
    if max_value == 0:
        filled_length = 0
    else:
        filled_length = int(round(width * value / max_value))

    bar = color + '█' * filled_length + Colors.END + '░' * (width - filled_length)
    return bar

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
        # Find max latency for bar scaling
        max_latency = max(latencies) * 1.2  # Add 20% padding
        
        print(f"\n{Colors.BOLD}WebSocket connection latency to {endpoint}:{Colors.END}")
        
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
        
        # Find max latency for bar scaling
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

async def compare_ws_endpoints(endpoints, methods, num_tests=3):
    """Compares multiple WebSocket RPC endpoints across various methods"""
    results = {}
    
    # Print header
    header = "SOLANA WEBSOCKET RPC ENDPOINT COMPARISON"
    print(f"\n{Colors.BG_BLUE}{Colors.BOLD} {header} {Colors.END}")
    print(f"{Colors.CYAN}Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}{Colors.END}")
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
    
    return results

def print_ws_summary(results, connection_results, endpoints):
    """Prints a summary of the benchmark results with color and charts"""
    summary_header = " WEBSOCKET PERFORMANCE SUMMARY "
    print(f"\n{Colors.BG_MAGENTA}{Colors.BOLD}{summary_header}{Colors.END}")
    
    # Connection latency summary
    print(f"\n{Colors.BOLD}{Colors.UNDERLINE}Connection Latency:{Colors.END}")
    if connection_results:
        all_medians = [result["median"] for result in connection_results.values()]
        max_median = max(all_medians) * 1.2 if all_medians else 100
        
        providers_sorted = sorted(connection_results.keys(), 
                               key=lambda x: connection_results[x]["median"])
        
        for provider in providers_sorted:
            median = connection_results[provider]["median"]
            color = latency_color(median)
            bar = create_horizontal_bar(median, max_median, width=40, color=color)
            provider_display = f"{provider.ljust(10)}"
            print(f"  {Colors.BOLD}{provider_display}{Colors.END}: {color}{median:.2f}ms{Colors.END} {bar}")
    
    # For each method, compare all providers
    for method in results:
        print(f"\n{Colors.BOLD}{Colors.UNDERLINE}{method}:{Colors.END}")
        
        if not results[method]:
            print(f"  {Colors.RED}No successful results for this method{Colors.END}")
            continue
            
        # Get all median values to determine max for bar scaling
        all_medians = [results[method][provider]["median"] for provider in results[method]]
        max_median = max(all_medians) * 1.2 if all_medians else 100
        
        # Display median values with bars
        providers_sorted = sorted(results[method].keys(), 
                               key=lambda x: results[method][x]["median"])
        
        for provider in providers_sorted:
            median = results[method][provider]["median"]
            color = latency_color(median)
            bar = create_horizontal_bar(median, max_median, width=40, color=color)
            provider_display = f"{provider.ljust(10)}"
            print(f"  {Colors.BOLD}{provider_display}{Colors.END}: {color}{median:.2f}ms{Colors.END} {bar}")
    
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
        medal = "🥇" if i == 0 else "🥈" if i == 1 else "🥉" if i == 2 else f"{i+1}."
        # Invert the scale for ranks (lower is better)
        bar_value = max_rank - avg_rank + 1
        bar = create_horizontal_bar(bar_value, max_rank, width=40, 
                               color=Colors.GREEN if i == 0 else Colors.BLUE if i == 1 else Colors.YELLOW)
        print(f"  {medal} {Colors.BOLD}{provider}{Colors.END}: {Colors.CYAN}{avg_rank:.2f}{Colors.END} average rank {bar}")

async def run_simple_benchmark():
    """Run a simple benchmark with default settings"""
    print(f"\n{Colors.BOLD}{Colors.YELLOW}Running simplified WebSocket RPC benchmark...{Colors.END}")
    await compare_ws_endpoints(
        endpoints=DEFAULT_ENDPOINTS,
        methods=DEFAULT_METHODS,
        num_tests=3
    )
    return 0

async def main_async():
    # Check if running in simple mode
    if len(sys.argv) == 2 and sys.argv[1] == "--simple":
        return await run_simple_benchmark()
    
    parser = argparse.ArgumentParser(description='Benchmark Solana WebSocket RPC providers')
    parser.add_argument('--endpoints', type=str, nargs='+', help='Custom WS endpoints in format name=url')
    parser.add_argument('--num-tests', type=int, default=3, help='Number of tests per method')
    parser.add_argument('--simple', action='store_true', help='Run in simplified mode')
    
    args = parser.parse_args()
    
    if args.simple:
        return await run_simple_benchmark()
    
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
        num_tests=args.num_tests
    )
    
    return 0

def main():
    return asyncio.run(main_async())

if __name__ == "__main__":
    sys.exit(main())