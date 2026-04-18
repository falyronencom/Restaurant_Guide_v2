import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:pdfx/pdfx.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Embedded PDF viewer screen using pdfx
///
/// Downloads the PDF from [pdfUrl] to the app cache on first open, then
/// renders it locally via pdfx. Cache is keyed by URL path so repeat
/// opens skip the network.
class PdfViewerScreen extends StatefulWidget {
  final String pdfUrl;
  final String title;

  const PdfViewerScreen({
    super.key,
    required this.pdfUrl,
    required this.title,
  });

  @override
  State<PdfViewerScreen> createState() => _PdfViewerScreenState();
}

class _PdfViewerScreenState extends State<PdfViewerScreen> {
  PdfControllerPinch? _controller;
  String? _error;
  int _pagesTotal = 0;
  int _currentPage = 1;

  @override
  void initState() {
    super.initState();
    _loadPdf();
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  /// Map a remote PDF URL to a stable local cache path
  Future<File> _cacheFileFor(String url) async {
    final dir = await getTemporaryDirectory();
    // Use hashCode + last path segment — collision odds are negligible and
    // keep the filename human-debuggable when inspecting the cache dir.
    final segment = Uri.parse(url).pathSegments.last;
    final safeName = '${url.hashCode.toUnsigned(32)}_$segment';
    return File('${dir.path}/pdf_cache/$safeName');
  }

  Future<void> _loadPdf() async {
    try {
      final cacheFile = await _cacheFileFor(widget.pdfUrl);

      if (!await cacheFile.exists()) {
        await cacheFile.parent.create(recursive: true);
        final dio = Dio();
        await dio.download(widget.pdfUrl, cacheFile.path);
      }

      final controller = PdfControllerPinch(
        document: PdfDocument.openFile(cacheFile.path),
      );

      if (!mounted) return;
      setState(() {
        _controller = controller;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Не удалось открыть PDF: $e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(
          widget.title,
          style: const TextStyle(fontSize: 16),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          if (_controller != null && _pagesTotal > 0)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Center(
                child: Text(
                  '$_currentPage / $_pagesTotal',
                  style: const TextStyle(color: Colors.white, fontSize: 14),
                ),
              ),
            ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error_outline, color: Colors.white, size: 48),
              const SizedBox(height: 16),
              Text(
                _error!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white),
              ),
            ],
          ),
        ),
      );
    }

    if (_controller == null) {
      return const Center(
        child: CircularProgressIndicator(
          valueColor: AlwaysStoppedAnimation<Color>(AppTheme.primaryOrange),
        ),
      );
    }

    return PdfViewPinch(
      controller: _controller!,
      onDocumentLoaded: (doc) {
        setState(() => _pagesTotal = doc.pagesCount);
      },
      onPageChanged: (page) {
        setState(() => _currentPage = page);
      },
    );
  }
}
