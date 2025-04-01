#!/usr/bin/env python3
"""
Solana RPC Benchmark - Tests the performance of multiple RPC providers
"""

import time
import json
import urllib.request
import statistics
import argparse
from datetime import datetime
import socket
import sys

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

def test_network_latency(host):
    """Tests basic network latency to the host using socket connection"""
    try:
        host = host.replace("https://", "").replace("http://", "").split("/")[0].split("?")[0]
        print(f"Testing network latency to {host}...")
        
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
                print(f"  Connection {i+1}: {latency:.2f}ms")
            except Exception as e:
                print(f"  Connection {i+1}: Failed - {str(e)}")
            time.sleep(0.5)
            
        if latencies:
            print(f"\nNetwork latency to {host}:")
            print(f"  Min: {min(latencies):.2f}ms")
            print(f"  Avg: {statistics.mean(latencies):.2f}ms")
            print(f"  Max: {max(latencies):.2f}ms")
            if len(latencies) > 1:
                print(f"  Stddev: {statistics.stdev(latencies):.2f}ms")
        else:
            print(f"\nNo successful connections to {host}")
            
    except Exception as e:
        print(f"Error testing network latency to {host}: {e}")
    
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
        print(f"{name}:")
    
    for i in range(num_tests):
        start_time = time.time()
        
        try:
            req = urllib.request.Request(endpoint, data=data_bytes, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as response:
                response_data = json.loads(response.read().decode('utf-8'))
                if 'error' in response_data:
                    if verbose:
                        print(f"  Test {i+1}: Error: {response_data['error']}")
                    continue
            
            latency = (time.time() - start_time) * 1000  # Convert to ms
            latencies.append(latency)
            if verbose:
                print(f"  Test {i+1}: {latency:.2f}ms")
            
        except Exception as e:
            if verbose:
                print(f"  Test {i+1}: Failed: {str(e)}")
        
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
            print(f"  Min: {result['min']:.2f}ms")
            print(f"  Median: {result['median']:.2f}ms")
            print(f"  Avg: {result['avg']:.2f}ms")
            print(f"  Max: {result['max']:.2f}ms")
            if result['failures'] > 0:
                print(f"  Failures: {result['failures']}/{num_tests}")
    elif verbose:
        print("  All tests failed")
    
    return result

def compare_endpoints(endpoints, methods, num_tests=5, verbose=True, network_test=True, include_summary=True):
    """Compares multiple RPC endpoints across various methods"""
    results = {}
    
    # Print header
    print(f"=== SOLANA RPC ENDPOINT COMPARISON ===")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Tests per method: {num_tests}")
    print("")
    
    # Test network latency first if requested
    if network_test:
        print("== NETWORK LATENCY TESTS ==")
        for name, endpoint in endpoints.items():
            test_network_latency(endpoint)
    
    # Run the RPC tests
    for method, params in methods:
        print(f"\n=== Testing '{method}' method ===")
        
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
    """Prints a summary of the benchmark results"""
    print("\n=== PERFORMANCE SUMMARY ===")
    
    # For each method, compare all providers
    for method in results:
        print(f"\n{method}:")
        
        # Compare each provider with every other provider
        provider_names = list(results[method].keys())
        for i, provider1 in enumerate(provider_names):
            for provider2 in provider_names[i+1:]:
                if provider1 in results[method] and provider2 in results[method]:
                    diff = results[method][provider1]["median"] - results[method][provider2]["median"]
                    print(f"  {provider1} vs {provider2}: {abs(diff):.2f}ms {provider1 if diff > 0 else provider2} is faster")
    
    # Ranking for transaction-critical operations
    critical_methods = ["getLatestBlockhash", "getSlot"]
    for critical in critical_methods:
        if critical in results:
            print(f"\n=== RANKING FOR {critical.upper()} ===")
            providers = []
            for provider in results[critical]:
                providers.append((provider, results[critical][provider]["median"]))
            
            providers.sort(key=lambda x: x[1])
            print(f"{critical} median latency ranking (fastest to slowest):")
            for i, (provider, latency) in enumerate(providers):
                print(f"  {i+1}. {provider}: {latency:.2f}ms")
    
    # Overall winner based on average ranking across all methods
    provider_rankings = {provider: [] for provider in endpoints}
    for method in results:
        providers = []
        for provider in results[method]:
            providers.append((provider, results[method][provider]["median"]))
        
        providers.sort(key=lambda x: x[1])
        for rank, (provider, _) in enumerate(providers):
            provider_rankings[provider].append(rank + 1)
    
    print("\n=== OVERALL RANKING ===")
    avg_rankings = []
    for provider, rankings in provider_rankings.items():
        if rankings:
            avg_rank = sum(rankings) / len(rankings)
            avg_rankings.append((provider, avg_rank))
    
    avg_rankings.sort(key=lambda x: x[1])
    for i, (provider, avg_rank) in enumerate(avg_rankings):
        print(f"  {i+1}. {provider}: {avg_rank:.2f} average rank")

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
    
    print(f"\nResults exported to {filename}")

def main():
    parser = argparse.ArgumentParser(description='Benchmark Solana RPC providers')
    parser.add_argument('--endpoints', type=str, nargs='+', help='Custom RPC endpoints in format name=url')
    parser.add_argument('--num-tests', type=int, default=5, help='Number of tests per method')
    parser.add_argument('--quiet', action='store_true', help='Suppress detailed output')
    parser.add_argument('--no-network-test', action='store_true', help='Skip network latency tests')
    parser.add_argument('--export', type=str, help='Export results to JSON file')
    
    args = parser.parse_args()
    
    # Set up endpoints
    endpoints = DEFAULT_ENDPOINTS.copy()
    if args.endpoints:
        for endpoint_arg in args.endpoints:
            try:
                name, url = endpoint_arg.split('=', 1)
                endpoints[name] = url
            except ValueError:
                print(f"Error: Invalid endpoint format '{endpoint_arg}'. Use 'name=url' format.")
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