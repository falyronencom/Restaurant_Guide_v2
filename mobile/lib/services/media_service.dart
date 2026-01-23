import 'dart:io';

import 'package:dio/dio.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Model for uploaded media response
class UploadedMedia {
  final String url;
  final String thumbnailUrl;
  final String previewUrl;
  final String? publicId;

  const UploadedMedia({
    required this.url,
    required this.thumbnailUrl,
    required this.previewUrl,
    this.publicId,
  });

  factory UploadedMedia.fromJson(Map<String, dynamic> json) {
    return UploadedMedia(
      url: json['url'] as String,
      thumbnailUrl: json['thumbnail_url'] as String,
      previewUrl: json['preview_url'] as String,
      publicId: json['public_id'] as String?,
    );
  }
}

/// Service for uploading media files to Cloudinary via backend API
///
/// This service handles image uploads during partner registration.
/// Files are uploaded to the backend which then uploads them to Cloudinary
/// and returns the CDN URLs.
class MediaService {
  final ApiClient _apiClient;

  // Singleton pattern
  static final MediaService _instance = MediaService._internal();
  factory MediaService() => _instance;

  MediaService._internal() : _apiClient = ApiClient();

  /// Upload an image file for partner registration
  ///
  /// [filePath] - Local file path of the image
  /// [type] - Media type: 'interior', 'exterior', 'menu', 'dishes'
  /// [onProgress] - Optional callback for upload progress (0.0 to 1.0)
  ///
  /// Returns [UploadedMedia] with Cloudinary URLs on success
  /// Throws exception on failure
  Future<UploadedMedia> uploadImage({
    required String filePath,
    required String type,
    void Function(double progress)? onProgress,
  }) async {
    final file = File(filePath);

    if (!await file.exists()) {
      throw Exception('File not found: $filePath');
    }

    // Create multipart form data
    final formData = FormData.fromMap({
      'file': await MultipartFile.fromFile(
        filePath,
        filename: file.path.split('/').last,
      ),
      'type': type,
    });

    try {
      final response = await _apiClient.dio.post(
        '/api/v1/partner/media/upload',
        data: formData,
        options: Options(
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        ),
        onSendProgress: (sent, total) {
          if (onProgress != null && total > 0) {
            onProgress(sent / total);
          }
        },
      );

      if (response.statusCode == 201 && response.data is Map<String, dynamic>) {
        final responseData = response.data as Map<String, dynamic>;

        if (responseData['success'] == true && responseData['data'] != null) {
          return UploadedMedia.fromJson(
            responseData['data'] as Map<String, dynamic>,
          );
        }
      }

      throw Exception('Unexpected response format');
    } on DioException catch (e) {
      // Extract error message
      String message = 'Failed to upload image';

      if (e.response?.data is Map<String, dynamic>) {
        final data = e.response!.data as Map<String, dynamic>;
        message = data['message'] as String? ?? message;
      } else if (e.error is String) {
        message = e.error as String;
      }

      throw Exception(message);
    } catch (e) {
      rethrow;
    }
  }

  /// Upload multiple images in parallel
  ///
  /// [files] - List of file paths and their types
  /// [onProgress] - Optional callback for overall progress (0.0 to 1.0)
  ///
  /// Returns list of [UploadedMedia] with Cloudinary URLs
  Future<List<UploadedMedia>> uploadImages({
    required List<({String path, String type})> files,
    void Function(double progress)? onProgress,
  }) async {
    if (files.isEmpty) {
      return [];
    }

    final results = <UploadedMedia>[];
    int completedCount = 0;

    for (final file in files) {
      try {
        final result = await uploadImage(
          filePath: file.path,
          type: file.type,
          onProgress: (fileProgress) {
            if (onProgress != null) {
              // Calculate overall progress
              final overallProgress =
                  (completedCount + fileProgress) / files.length;
              onProgress(overallProgress);
            }
          },
        );

        results.add(result);
        completedCount++;

        if (onProgress != null) {
          onProgress(completedCount / files.length);
        }
      } catch (e) {
        // Re-throw error - caller will handle it
        rethrow;
      }
    }

    return results;
  }
}
