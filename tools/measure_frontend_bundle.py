"""Measure a Vite build's static JS import graph without executing the bundle."""
from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path


def measure(directory: Path) -> dict:
    manifest = json.loads((directory / '.vite/manifest.json').read_text())
    routes = [
        'index.html',
        'src/views/auth/LoginView.vue',
        'src/views/user/DashboardView.vue',
        'src/views/admin/UsageView.vue',
        'src/views/user/AirwallexPaymentView.vue',
        'src/views/admin/AccountsView.vue',
        'src/views/admin/SettingsView.vue',
    ]

    def byte_info(file: Path) -> dict:
        data = file.read_bytes()
        return {'bytes': len(data), 'gzip_bytes': len(gzip.compress(data, mtime=0))}

    def graph(route: str) -> dict:
        visited = set()

        def visit(key: str) -> None:
            if key in visited:
                return
            visited.add(key)
            for dependency in manifest[key].get('imports', []):
                visit(dependency)

        visit('index.html')
        visit(route)
        files = [
            {'source': key, 'file': manifest[key]['file'], **byte_info(directory / manifest[key]['file'])}
            for key in sorted(visited)
            if manifest[key]['file'].endswith('.js')
        ]
        return {
            'files': files,
            'js_bytes': sum(file['bytes'] for file in files),
            'gzip_js_bytes': sum(file['gzip_bytes'] for file in files),
        }

    vendors = {
        path.name: byte_info(path)
        for path in sorted((directory / 'app-assets').glob('vendor-*.js'))
    }
    all_js = [
        {'file': str(path.relative_to(directory)), **byte_info(path)}
        for path in sorted((directory / 'app-assets').glob('*.js'))
    ]
    return {
        'directory': str(directory),
        'method': 'Sum individually gzip-compressed JS files reachable through manifest imports from index.html and the route. Excludes dynamicImports, CSS/images, transport overhead and browser timings.',
        'routes': {route: graph(route) for route in routes if route in manifest},
        'vendor_chunks': vendors,
        'largest_js_chunks': sorted(all_js, key=lambda file: file['bytes'], reverse=True)[:10],
        'all_js_files': len(all_js),
        'all_js_bytes': sum(file['bytes'] for file in all_js),
    }


if __name__ == '__main__':
    directory, output = map(Path, sys.argv[1:3])
    result = measure(directory)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({route: {key: value for key, value in graph.items() if key != 'files'} for route, graph in result['routes'].items()}, ensure_ascii=False, indent=2))
