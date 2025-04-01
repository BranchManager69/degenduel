#!/usr/bin/env python3
"""
Solana RPC Benchmark - Tests the performance of multiple RPC providers
Enhanced version with colorized output and visual charts
"""

import time
import json
import urllib.request
import statistics
import argparse
from datetime import datetime
import socket
import sys
import os

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

# Default RPC endpoints - you can modify these or add your own
DEFAULT_ENDPOINTS = {
    "Helius": "https://mainnet.helius-rpc.com/?api-key=8fd1a2cd-76e7-4462-b38b-1026960edd40",
    "Official": "https://api.mainnet-beta.solana.com",
    "QuikNode": "https://still-neat-log.solana-mainnet.quiknode.pro/2a0ede8be35aa5c655c08939f1831e8fb52ddeba/"
}

# Methods to test - you can modify or expand these
DEFAULT_METHODS = [
    ("getHealth", []),
    ("getLatestBlockhash", [{"commitment": "processed"}]),
    ("getSlot", []),
    ("getVersion", []),
    # Additional methods can be added here
    # ("getBalance", ["vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg"]),
    # ("getBlockTime", [100000000]),
]

# Get terminal width for formatting
def get_terminal_width():
    try:
        return os.get_terminal_size().columns
    except (AttributeError, OSError):
        return 80  # Default fallback

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

def test_network_latency(host):
    """Tests basic network latency to the host using socket connection"""
    try:
        host = host.replace("https://", "").replace("http://", "").split("/")[0].split("?")[0]
        print(f"{Colors.BOLD}{Colors.UNDERLINE}Testing network latency to {host}...{Colors.END}")
        
        latencies = []
        for i in range(5):
            start_time = time.time()
            try:
                # Create a socket connection to port 443 (HTTPS)
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(3)
                s.connect((host, 443))
                s.close()
                latency = (time.time() - start_time) * 1000  # ms
                latencies.append(latency)
                color = latency_color(latency)
                print(f"  Connection {i+1}: {color}{latency:.2f}ms{Colors.END}")
            except Exception as e:
                print(f"  Connection {i+1}: {Colors.RED}Failed - {str(e)}{Colors.END}")
            time.sleep(0.5)
            
        if latencies:
            # Find max latency for bar scaling
            max_latency = max(latencies) * 1.2  # Add 20% padding
            
            print(f"\n{Colors.BOLD}Network latency to {host}:{Colors.END}")
            
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
            print(f"\n{Colors.RED}No successful connections to {host}{Colors.END}")
            
    except Exception as e:
        print(f"{Colors.RED}Error testing network latency to {host}: {e}{Colors.END}")
    
    print("")

def test_rpc_latency(name, endpoint, method, params=None, num_tests=5, verbose=True):
    """Tests the latency of a specific RPC method call"""
    if params is None:
        params = []
    
    headers = {
        'Content-Type': 'application/json',
    }
    
    data = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params
    }
    
    data_bytes = json.dumps(data).encode('utf-8')
    
    latencies = []
    if verbose:
        print(f"{Colors.BOLD}{Colors.CYAN}{name}:{Colors.END}")
    
    for i in range(num_tests):
        start_time = time.time()
        
        try:
            req = urllib.request.Request(endpoint, data=data_bytes, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as response:
                response_data = json.loads(response.read().decode('utf-8'))
                if 'error' in response_data:
                    if verbose:
                        print(f"  Test {i+1}: {Colors.RED}Error: {response_data['error']}{Colors.END}")
                    continue
            
            latency = (time.time() - start_time) * 1000  # Convert to ms
            latencies.append(latency)
            if verbose:
                color = latency_color(latency)
                print(f"  Test {i+1}: {color}{latency:.2f}ms{Colors.END}")
            
        except Exception as e:
            if verbose:
                print(f"  Test {i+1}: {Colors.RED}Failed: {str(e)}{Colors.END}")
        
        # Brief pause between tests
        time.sleep(0.5)
    
    result = None
    if latencies:
        result = {
            "min": min(latencies),
            "max": max(latencies),
            "avg": statistics.mean(latencies),
            "median": statistics.median(latencies),
            "stdev": statistics.stdev(latencies) if len(latencies) > 1 else 0,
            "count": len(latencies),
            "failures": num_tests - len(latencies)
        }
        
        if verbose:
            # Find max latency for bar scaling
            max_latency = max(latencies) * 1.2  # Add 20% padding
            
            # Min latency with bar
            min_lat = result['min']
            color = latency_color(min_lat)
            bar = create_horizontal_bar(min_lat, max_latency, width=30, color=color)
            print(f"  Min: {color}{min_lat:.2f}ms{Colors.END} {bar}")
            
            # Median with bar
            median_lat = result['median']
            color = latency_color(median_lat)
            bar = create_horizontal_bar(median_lat, max_latency, width=30, color=color)
            print(f"  Median: {color}{median_lat:.2f}ms{Colors.END} {bar}")
            
            # Avg latency with bar
            avg_lat = result['avg']
            color = latency_color(avg_lat)
            bar = create_horizontal_bar(avg_lat, max_latency, width=30, color=color)
            print(f"  Avg: {color}{avg_lat:.2f}ms{Colors.END} {bar}")
            
            # Max latency with bar
            max_lat = result['max']
            color = latency_color(max_lat)
            bar = create_horizontal_bar(max_lat, max_latency, width=30, color=color)
            print(f"  Max: {color}{max_lat:.2f}ms{Colors.END} {bar}")
            
            if result['failures'] > 0:
                print(f"  Failures: {Colors.RED}{result['failures']}/{num_tests}{Colors.END}")
    elif verbose:
        print(f"  {Colors.RED}All tests failed{Colors.END}")
    
    return result

def compare_endpoints(endpoints, methods, num_tests=5, verbose=True, network_test=True, include_summary=True):
    """Compares multiple RPC endpoints across various methods"""
    results = {}
    terminal_width = get_terminal_width()
    
    # Print header with a nice box
    header = "SOLANA RPC ENDPOINT COMPARISON"
    padding = (terminal_width - len(header) - 4) // 2
    print(f"\n{Colors.BG_BLUE}{Colors.BOLD}{' ' * padding} {header} {' ' * padding}{Colors.END}")
    print(f"{Colors.CYAN}Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}{Colors.END}")
    print(f"{Colors.CYAN}Tests per method: {num_tests}{Colors.END}")
    print("")
    
    # Test network latency first if requested
    if network_test:
        print(f"{Colors.BG_YELLOW}{Colors.BOLD} NETWORK LATENCY TESTS {Colors.END}")
        for name, endpoint in endpoints.items():
            test_network_latency(endpoint)
    
    # Run the RPC tests
    for method, params in methods:
        section_header = f" Testing '{method}' method "
        padding = (terminal_width - len(section_header) - 4) // 2
        print(f"\n{Colors.BG_CYAN}{Colors.BOLD}{' ' * padding}{section_header}{' ' * padding}{Colors.END}")
        
        if method not in results:
            results[method] = {}
        
        for name, endpoint in endpoints.items():
            result = test_rpc_latency(name, endpoint, method, params, num_tests, verbose)
            if result:
                results[method][name] = result
    
    # Performance summary if requested
    if include_summary:
        print_summary(results, endpoints)
    
    return results

def print_summary(results, endpoints):
    """Prints a summary of the benchmark results with color and charts"""
    terminal_width = get_terminal_width()
    
    summary_header = " PERFORMANCE SUMMARY "
    padding = (terminal_width - len(summary_header) - 4) // 2
    print(f"\n{Colors.BG_MAGENTA}{Colors.BOLD}{' ' * padding}{summary_header}{' ' * padding}{Colors.END}")
    
    # For each method, compare all providers
    for method in results:
        print(f"\n{Colors.BOLD}{Colors.UNDERLINE}{method}:{Colors.END}")
        
        # Get all median values to determine max for bar scaling
        all_medians = [results[method][provider]["median"] for provider in results[method]]
        max_median = max(all_medians) * 1.2 if all_medians else 100  # Add 20% padding
        
        # Display median values with bars
        providers_sorted = sorted(results[method].keys(), 
                                 key=lambda x: results[method][x]["median"])
        
        for provider in providers_sorted:
            median = results[method][provider]["median"]
            color = latency_color(median)
            bar = create_horizontal_bar(median, max_median, width=40, color=color)
            provider_display = f"{provider.ljust(10)}"
            print(f"  {Colors.BOLD}{provider_display}{Colors.END}: {color}{median:.2f}ms{Colors.END} {bar}")
        
        # Compare each provider with every other provider
        provider_names = list(results[method].keys())
        for i, provider1 in enumerate(provider_names):
            for provider2 in provider_names[i+1:]:
                if provider1 in results[method] and provider2 in results[method]:
                    diff = results[method][provider1]["median"] - results[method][provider2]["median"]
                    faster = provider2 if diff > 0 else provider1
                    percent = abs(diff) / max(results[method][provider1]["median"], results[method][provider2]["median"]) * 100
                    
                    # Color code based on which one is faster
                    if faster == provider1:
                        print(f"  {Colors.GREEN}{provider1}{Colors.END} vs {Colors.RED}{provider2}{Colors.END}: " +
                              f"{Colors.BOLD}{abs(diff):.2f}ms{Colors.END} ({percent:.1f}%) faster")
                    else:
                        print(f"  {Colors.RED}{provider1}{Colors.END} vs {Colors.GREEN}{provider2}{Colors.END}: " +
                              f"{Colors.BOLD}{abs(diff):.2f}ms{Colors.END} ({percent:.1f}%) slower")
    
    # Ranking for transaction-critical operations
    critical_methods = ["getLatestBlockhash", "getSlot"]
    for critical in critical_methods:
        if critical in results:
            critical_header = f" RANKING FOR {critical.upper()} "
            padding = (terminal_width - len(critical_header) - 4) // 2
            print(f"\n{Colors.BG_GREEN}{Colors.BOLD}{' ' * padding}{critical_header}{' ' * padding}{Colors.END}")
            
            providers = []
            for provider in results[critical]:
                providers.append((provider, results[critical][provider]["median"]))
            
            providers.sort(key=lambda x: x[1])
            max_latency = providers[-1][1] * 1.2 if providers else 100  # Add 20% padding
            
            print(f"{Colors.BOLD}Median latency ranking (fastest to slowest):{Colors.END}")
            for i, (provider, latency) in enumerate(providers):
                medal = "🥇" if i == 0 else "🥈" if i == 1 else "🥉" if i == 2 else f"{i+1}."
                color = latency_color(latency)
                bar = create_horizontal_bar(latency, max_latency, width=40, color=color)
                print(f"  {medal} {Colors.BOLD}{provider}{Colors.END}: {color}{latency:.2f}ms{Colors.END} {bar}")
    
    # Overall winner based on average ranking across all methods
    provider_rankings = {provider: [] for provider in endpoints}
    for method in results:
        providers = []
        for provider in results[method]:
            providers.append((provider, results[method][provider]["median"]))
        
        providers.sort(key=lambda x: x[1])
        for rank, (provider, _) in enumerate(providers):
            provider_rankings[provider].append(rank + 1)
    
    overall_header = " OVERALL RANKING "
    padding = (terminal_width - len(overall_header) - 4) // 2
    print(f"\n{Colors.BG_BLUE}{Colors.BOLD}{' ' * padding}{overall_header}{' ' * padding}{Colors.END}")
    
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

def export_results_json(results, filename):
    """Exports the benchmark results to a JSON file"""
    # Convert results to a serializable format
    serializable_results = {}
    for method in results:
        serializable_results[method] = {}
        for provider in results[method]:
            serializable_results[method][provider] = results[method][provider]
    
    with open(filename, 'w') as f:
        json.dump(serializable_results, f, indent=2)
    
    print(f"\n{Colors.GREEN}Results exported to {filename}{Colors.END}")

def run_simple_benchmark():
    """Run a simple benchmark with default settings for npm script"""
    print(f"\n{Colors.BOLD}{Colors.YELLOW}Running simplified RPC benchmark...{Colors.END}")
    compare_endpoints(
        endpoints=DEFAULT_ENDPOINTS,
        methods=DEFAULT_METHODS,
        num_tests=3,  # Reduced number for quicker results
        verbose=True,
        network_test=True
    )
    return 0

def main():
    # Check if running in simple mode via NPM
    if len(sys.argv) == 2 and sys.argv[1] == "--simple":
        return run_simple_benchmark()
    
    parser = argparse.ArgumentParser(description='Benchmark Solana RPC providers')
    parser.add_argument('--endpoints', type=str, nargs='+', help='Custom RPC endpoints in format name=url')
    parser.add_argument('--num-tests', type=int, default=5, help='Number of tests per method')
    parser.add_argument('--quiet', action='store_true', help='Suppress detailed output')
    parser.add_argument('--no-network-test', action='store_true', help='Skip network latency tests')
    parser.add_argument('--export', type=str, help='Export results to JSON file')
    parser.add_argument('--simple', action='store_true', help='Run in simplified mode for npm script')
    
    args = parser.parse_args()
    
    if args.simple:
        return run_simple_benchmark()
    
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
    results = compare_endpoints(
        endpoints=endpoints,
        methods=DEFAULT_METHODS,
        num_tests=args.num_tests,
        verbose=not args.quiet,
        network_test=not args.no_network_test
    )
    
    # Export results if requested
    if args.export:
        export_results_json(results, args.export)
    
    return 0

if __name__ == "__main__":
    sys.exit(main())